/*
 * FitYear service worker - rest-timer push only.
 *
 * Deliberately does NOT cache or intercept fetches: the app is auth-gated and
 * data-heavy, and a stale-serving SW would be a much worse bug than the one
 * this solves. Its only job is to show the "rest is over" notification that a
 * closed app cannot fire itself (iOS suspends JS in background tabs).
 */

self.addEventListener("install", () => {
  // Take over immediately so a fresh subscription works on first load.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "Rest Complete";
  const body = payload.body || "Time for your next set.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Replaces any earlier rest alert rather than stacking them, and matches
      // the tag the in-app Notification uses.
      tag: "rest-timer",
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: payload.url || "/track" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/track";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab if the app is already open, else open one.
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
