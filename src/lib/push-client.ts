/**
 * Client half of the rest-timer push: service-worker registration, permission,
 * and subscription hand-off to the server.
 *
 * iOS caveat worth knowing before debugging "it doesn't work on my phone":
 * Safari only allows Web Push for a PWA the user has ADDED TO THE HOME SCREEN
 * (iOS 16.4+). In a normal Safari tab `PushManager` is absent, so
 * `pushSupported()` is false and the UI says so rather than silently failing.
 */

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Backed by a concrete ArrayBuffer (not ArrayBufferLike) so it satisfies
  // BufferSource for applicationServerKey.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** True when the page is running as an installed PWA (the iOS push prerequisite). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/**
 * Ask for permission (must be called from a user gesture), subscribe, and
 * persist the subscription server-side. Returns why it failed so the caller can
 * say something useful instead of "something went wrong".
 */
export async function enableRestPush(): Promise<
  { ok: true } | { ok: false; reason: "unsupported" | "denied" | "failed" }
> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return { ok: false, reason: "unsupported" };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  try {
    const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
    if (!registration) return { ok: false, reason: "failed" };
    await navigator.serviceWorker.ready;

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      }));

    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    return res.ok ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Whether this browser already has a live push subscription. */
export async function hasRestPush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    return (await registration.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}
