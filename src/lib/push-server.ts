import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

/**
 * Server half of the rest-timer push, for BOTH delivery channels.
 *
 * Web Push does not exist inside a WKWebView, so the iOS app cannot use the
 * `sw.js` + VAPID path at all - it registers an APNs device token instead.
 * Both kinds live in `push_subscriptions`, distinguished by `kind`, and both
 * are delivered from here. That is deliberate: the delay is a sleeping Vercel
 * Workflow (`workflows/rest-alert.ts`) which calls `sendPushToUser` and knows
 * nothing about channels, so adding iOS changed no scheduling code whatsoever.
 *
 * A user can legitimately have both: the installed PWA on a laptop and the
 * native app on a phone. Every device the user has subscribed gets the alert.
 */

let webConfigured = false;

function configureWebPush(): boolean {
  if (webConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:ivo@marketeq.co",
    publicKey,
    privateKey,
  );
  webConfigured = true;
  return true;
}

/**
 * The APNs provider, built once and reused - it holds an HTTP/2 connection
 * pool, so constructing one per send would be both slow and rude to Apple.
 *
 * The key arrives base64-encoded in an env var rather than as a file, because
 * Vercel has no filesystem to put a `.p8` on. `APNS_KEY_PATH` is the local
 * fallback so a script on this machine can use the same key the portal issued.
 */
type ApnProvider = import("@parse/node-apn").Provider;
let apnProvider: ApnProvider | null | undefined;

async function getApnProvider(): Promise<ApnProvider | null> {
  if (apnProvider !== undefined) return apnProvider;

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const b64 = process.env.APNS_KEY_P8_BASE64;
  const keyPath = process.env.APNS_KEY_PATH;

  if (!keyId || !teamId || (!b64 && !keyPath)) {
    apnProvider = null;
    return null;
  }

  let key: string;
  if (b64) {
    key = Buffer.from(b64, "base64").toString("utf8");
  } else {
    const fs = await import("node:fs/promises");
    key = await fs.readFile(keyPath!, "utf8");
  }

  const apn = await import("@parse/node-apn");
  apnProvider = new apn.Provider({
    token: { key, keyId, teamId },
    // A build signed with a Development profile talks to the sandbox; the App
    // Store / TestFlight build talks to production. Same key either way.
    production: process.env.APNS_PRODUCTION !== "false",
  });
  return apnProvider;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Forget a subscription the push service says is dead. */
async function prune(where: ReturnType<typeof eq>): Promise<void> {
  await db.delete(pushSubscriptions).where(where);
}

async function sendWebPush(
  subs: Array<{ endpoint: string | null; p256dh: string | null; auth: string | null }>,
  payload: PushPayload,
): Promise<number> {
  if (subs.length === 0) return 0;
  if (!configureWebPush()) {
    console.error("[push] VAPID keys missing - cannot send web push");
    return 0;
  }
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      if (!sub.endpoint || !sub.p256dh || !sub.auth) return;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped it (uninstalled PWA, cleared data).
        if (status === 404 || status === 410) {
          await prune(eq(pushSubscriptions.endpoint, sub.endpoint));
        } else {
          console.error("[push] web send failed:", status, (e as Error).message);
        }
      }
    }),
  );
  return sent;
}

/** APNs reasons that mean "this device is gone", as opposed to a transient fault. */
const APNS_DEAD_TOKEN = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

async function sendApns(tokens: string[], payload: PushPayload): Promise<number> {
  if (tokens.length === 0) return 0;
  const provider = await getApnProvider();
  const topic = process.env.APNS_BUNDLE_ID;
  if (!provider || !topic) {
    console.error("[push] APNs not configured - cannot send to iOS devices");
    return 0;
  }

  const apn = await import("@parse/node-apn");
  const note = new apn.Notification();
  note.topic = topic;
  note.alert = { title: payload.title, body: payload.body };
  note.sound = "default";
  // The APNs analogue of the web notification's `tag`: a newer rest alert
  // REPLACES the previous one on the lock screen rather than stacking.
  note.collapseId = "rest-timer";
  note.threadId = "rest-timer";
  note.payload = { url: payload.url ?? "/track" };
  // A rest alert is worthless once the rest is long over, so let APNs stop
  // retrying rather than delivering it an hour late.
  note.expiry = Math.floor(Date.now() / 1000) + 3600;

  const result = await provider.send(note, tokens);

  for (const failure of result.failed) {
    const reason = failure.response?.reason;
    if (reason && APNS_DEAD_TOKEN.has(reason)) {
      await prune(eq(pushSubscriptions.apnsToken, failure.device));
    } else {
      console.error("[push] apns send failed:", failure.status, reason ?? failure.error?.message);
    }
  }
  return result.sent.length;
}

/**
 * Send to every device the user has subscribed, on whichever channel each one
 * uses. Returns how many landed.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  const web = subs.filter((s) => s.kind !== "apns");
  const apnsTokens = subs
    .filter((s) => s.kind === "apns" && s.apnsToken)
    .map((s) => s.apnsToken as string);

  const [webSent, apnsSent] = await Promise.all([
    sendWebPush(web, payload),
    sendApns(apnsTokens, payload),
  ]);
  return webSent + apnsSent;
}

/** True when this user has at least one device that could receive an alert. */
export async function userHasPushDevice(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .limit(1);
  return !!row;
}
