import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

/**
 * Hosts we will hand to `webpush.sendNotification`. The endpoint is a URL the
 * SERVER then POSTs to, so accepting an arbitrary one turned this into a blind
 * request relay: any absolute URL (link-local metadata, an internal address, a
 * third party) would be fetched from the Vercel function, on a delay, as many
 * times as the caller armed rests.
 */
const PUSH_HOSTS = [
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^([a-z0-9-]+\.)*fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*android\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*notify\.windows\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
];

function isPushServiceEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return PUSH_HOSTS.some((re) => re.test(url.hostname));
}

// Two shapes, because there are two delivery channels. A browser sends the
// output of PushSubscription.toJSON(); the iOS app has no Web Push at all (it
// does not exist inside a WKWebView) and sends an APNs device token instead.
const WebPushSchema = z.object({
  kind: z.literal("webpush").optional(),
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine(isPushServiceEndpoint, "endpoint must be a known push service URL"),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255),
  }),
});

// An APNs token is 32 bytes hex today, but Apple has changed the length before
// and says not to hard-code it, so this bounds it rather than pinning it.
const ApnsSchema = z.object({
  kind: z.literal("apns"),
  token: z
    .string()
    .regex(/^[0-9a-fA-F]+$/, "an APNs device token is hexadecimal")
    .min(32)
    .max(200),
});

const PostSchema = z.union([ApnsSchema, WebPushSchema]);

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  // The endpoint (or the device token) IS the device identity, so re-subscribing
  // - or a device moving between accounts - updates in place rather than
  // accumulating rows that would all buzz the same phone.
  if ("kind" in body && body.kind === "apns") {
    await db
      .insert(pushSubscriptions)
      .values({ userId: user.id, kind: "apns", apnsToken: body.token })
      .onConflictDoUpdate({
        target: pushSubscriptions.apnsToken,
        set: { userId: user.id, kind: "apns" },
      });
    return { ok: true, kind: "apns" };
  }

  await db
    .insert(pushSubscriptions)
    .values({
      userId: user.id,
      kind: "webpush",
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, kind: "webpush", p256dh: body.keys.p256dh, auth: body.keys.auth },
    });

  return { ok: true, kind: "webpush" };
});
