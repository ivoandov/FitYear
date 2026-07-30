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

// Shape of PushSubscription.toJSON().
const PostSchema = z.object({
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

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  // The endpoint IS the device identity, so re-subscribing (or a device moving
  // between accounts) updates in place rather than accumulating rows.
  await db
    .insert(pushSubscriptions)
    .values({
      userId: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });

  return { ok: true };
});
