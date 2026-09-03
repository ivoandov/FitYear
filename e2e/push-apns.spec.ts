/**
 * The APNs half of rest alerts, and the guarantee that adding it changed
 * nothing for Web Push.
 *
 * Web Push does not exist inside a WKWebView, so the iOS app registers an APNs
 * device token instead. Both kinds live in `push_subscriptions` so
 * `sendPushToUser` stays the single fan-out point and the sleeping rest-alert
 * workflow was not touched at all.
 *
 * These drive the routes with in-browser fetch (the same technique
 * rest-push.spec.ts uses and documents) rather than a real device: APNs
 * delivery itself can only be proven on hardware, but the storage contract,
 * the validation and the channel independence can all be proven here.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { sql } from "./helpers";

/**
 * MUST be hexadecimal: the route validates that an APNs token is hex, so a
 * readable marker like "e2e-apns" is correctly REJECTED and the test then
 * fails for the wrong reason. "ffff..." is both a valid token shape and
 * recognisable enough to clean up by prefix.
 */
const MARKER = "ffffffff";

async function apiPost(page: import("@playwright/test").Page, url: string, body: unknown) {
  return page.evaluate(
    async ([u, b]) => {
      const res = await fetch(u as string, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json } as { status: number; json: { kind?: string } | null };
    },
    [url, body] as const,
  );
}

test.afterEach(async () => {
  await sql`delete from push_subscriptions where apns_token like ${`${MARKER}%`}`;
});

test("an iOS device registers an APNs token, and re-registering updates in place", async ({
  page,
  account,
}) => {
  await page.goto("/");
  const token = `${MARKER}${"a".repeat(32)}`;

  const first = await apiPost(page, "/api/push/subscribe", { kind: "apns", token });
  expect(first.status).toBe(200);
  expect(first.json?.kind).toBe("apns");

  const rows = (await sql`
    select user_id, kind, apns_token, endpoint, p256dh, auth
      from push_subscriptions where apns_token = ${token}`) as unknown as Array<{
    user_id: string;
    kind: string;
    endpoint: string | null;
    p256dh: string | null;
    auth: string | null;
  }>;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ user_id: account.id, kind: "apns" });
  // The web-only columns are NULL for an APNs row - that is what dropping their
  // NOT NULL was for.
  expect(rows[0].endpoint).toBeNull();
  expect(rows[0].p256dh).toBeNull();
  expect(rows[0].auth).toBeNull();

  // The token IS the device identity: registering it again must not create a
  // second row, or one phone would buzz twice per rest.
  const again = await apiPost(page, "/api/push/subscribe", { kind: "apns", token });
  expect(again.status).toBe(200);
  const [{ n }] = (await sql`
    select count(*)::int as n from push_subscriptions where apns_token = ${token}`) as unknown as Array<{
    n: number;
  }>;
  expect(n).toBe(1);
});

test("a malformed APNs token is rejected rather than stored", async ({ page, account }) => {
  // `account` is required even though it is unused below: without a session the
  // proxy 307s /api to /login and fetch FOLLOWS it, so a bad request reads the
  // login page's 200 and looks like it was accepted.
  void account;
  await page.goto("/");
  // Not hexadecimal, and far too short. The column is unique, so junk here
  // would occupy the identity of a real device.
  for (const token of ["not-a-hex-token", "abc", ""]) {
    const res = await apiPost(page, "/api/push/subscribe", { kind: "apns", token });
    expect(res.status, `token ${JSON.stringify(token)} must be refused`).toBe(400);
  }
});

test("the WEB PUSH path is unchanged, and the two channels coexist", async ({ page, account }) => {
  await page.goto("/");
  // A browser subscription, in the shape PushSubscription.toJSON() produces.
  // The host allowlist is still enforced, which is the guard that stops this
  // route being used as a blind request relay.
  const endpoint = `https://fcm.googleapis.com/fcm/send/${MARKER}-${Date.now()}`;
  const web = await apiPost(page, "/api/push/subscribe", {
    endpoint,
    keys: { p256dh: "test-p256dh", auth: "test-auth" },
  });
  expect(web.status).toBe(200);
  expect(web.json?.kind).toBe("webpush");

  const apns = await apiPost(page, "/api/push/subscribe", {
    kind: "apns",
    token: `${MARKER}${"b".repeat(32)}`,
  });
  expect(apns.status).toBe(200);

  // One user, one laptop PWA and one phone: both rows stand, so both devices
  // get the alert.
  const rows = (await sql`
    select kind from push_subscriptions where user_id = ${account.id}::uuid order by kind`) as unknown as Array<{
    kind: string;
  }>;
  expect(rows.map((r) => r.kind)).toEqual(["apns", "webpush"]);

  await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
});

test("an endpoint outside the push-service allowlist is still refused", async ({ page, account }) => {
  void account; // see the note above: unauthenticated requests read /login, not the API.
  await page.goto("/");
  // The server POSTs to this URL later, so an arbitrary one turns the route
  // into a blind request relay. Unchanged by the APNs work; asserted here so a
  // future edit to the union cannot quietly drop the guard.
  const res = await apiPost(page, "/api/push/subscribe", {
    endpoint: "https://evil.example.com/relay",
    keys: { p256dh: "x", auth: "y" },
  });
  expect(res.status).toBe(400);
});
