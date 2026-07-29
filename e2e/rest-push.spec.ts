import { createECDH, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { sql, createTempUser, deleteTempUser } from "./helpers";

/**
 * Guards the CLOSED-APP rest-alert pipeline: schedule -> a sleeping Vercel
 * Workflow -> Web Push. Web Push has no delayed delivery and Hobby cron is
 * daily-only, so the delay lives in `src/workflows/rest-alert.ts`, which sleeps
 * the rest duration and only sends while the row is still `pending`. That
 * sleep/wake/guard chain is what regresses, and nothing else re-verifies it -
 * the feature shipped on hand-drives and prod has zero real subscriptions, so a
 * break would go unnoticed until someone next locks their phone mid-rest.
 *
 * WHY A FAKE PUSH ENDPOINT IS CORRECT (do not "fix" this to a real one):
 * `sendPushToUser` catches a failed send and only prunes the subscription on
 * 404/410; anything else is logged and the row still moves to `sent`. So an
 * unroutable `https://example.test/...` endpoint proves the whole server-side
 * chain woke up and ran, without depending on Apple/Google delivery - which
 * cannot be tested from CI at all.
 *
 * Requires a PRODUCTION build (`npm run build && npm run start`); the Workflow
 * runtime is not exercised the same way under `next dev`.
 */

const MARKER = "e2e-push";

type PushResult = {
  ok?: boolean;
  scheduled?: boolean;
  fireAt?: string;
  error?: string;
} | null;

/**
 * Drive the API from INSIDE the page. `page.request.*` does not carry the
 * Supabase session cookie for these routes - every call 302s to the login HTML.
 */
async function apiPost(
  page: Page,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: PushResult }> {
  return page.evaluate(
    async ({ path, body }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    },
    { path, body },
  );
}

// A structurally valid subscription pointed at an unroutable host: web-push
// encrypts against these keys and then fails at the network (~60ms, NXDOMAIN).
function fakeSubscription(id: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: `https://example.test/${MARKER}/${id}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}

async function restRow(restId: string) {
  const [row] = await sql`
    select status, user_id, exercise_name
    from rest_notifications
    where id = ${restId}`;
  return row as
    | { status: string; user_id: string; exercise_name: string | null }
    | undefined;
}

// The temp user cascades, but these rows outlive a failed test otherwise, and
// test 4 seeds a row owned by a second user the fixture does not manage.
test.afterEach(async () => {
  await sql`delete from rest_notifications where id like ${`${MARKER}-%`}`;
  await sql`delete from push_subscriptions where endpoint like ${`https://example.test/${MARKER}/%`}`;
});

test("the sleeping workflow wakes and delivers a scheduled rest alert", async ({
  page,
  account: _account,
}) => {
  // The workflow really sleeps, so this test really waits.
  test.setTimeout(120_000);
  const restId = `${MARKER}-deliver-${Date.now()}`;
  await page.goto("/");

  const subscribed = await apiPost(page, "/api/push/subscribe", fakeSubscription(restId));
  expect(subscribed.status).toBe(200);

  const scheduled = await apiPost(page, "/api/push/schedule", {
    restId,
    delaySeconds: 5,
    exerciseName: "Bench Press",
  });
  expect(scheduled.status).toBe(200);
  expect(scheduled.json?.scheduled).toBe(true);

  expect((await restRow(restId))?.status).toBe("pending");

  // The ONLY assertion that proves the workflow slept, woke, re-read the row
  // and ran the send step. Generous budget: the run is queued, not instant.
  await expect
    .poll(async () => (await restRow(restId))?.status, {
      timeout: 90_000,
      intervals: [2000],
    })
    .toBe("sent");
});

test("a cancel that arrives first wins - schedule cannot un-cancel it", async ({
  page,
  account: _account,
}) => {
  const restId = `${MARKER}-tombstone-${Date.now()}`;
  await page.goto("/");

  // Subscribed on purpose: without it, schedule short-circuits on "no device"
  // and a `scheduled: false` would prove nothing about the tombstone.
  const subscribed = await apiPost(page, "/api/push/subscribe", fakeSubscription(restId));
  expect(subscribed.status).toBe(200);

  // Skipping a rest a second after starting it means the cancel can beat the
  // schedule request. A plain UPDATE matched zero rows here and silently left
  // the alert armed, so cancel writes a tombstone row instead.
  const cancelled = await apiPost(page, "/api/push/cancel", { restId });
  expect(cancelled.status).toBe(200);
  expect((await restRow(restId))?.status).toBe("cancelled");

  const scheduled = await apiPost(page, "/api/push/schedule", {
    restId,
    delaySeconds: 5,
    exerciseName: "Bench Press",
  });
  expect(scheduled.status).toBe(200);
  expect(scheduled.json?.scheduled).toBe(false);

  // Past the delay we asked for: nothing is sleeping on this id, so the row
  // must still be cancelled rather than having flipped to sent.
  await page.waitForTimeout(8_000);
  expect((await restRow(restId))?.status).toBe("cancelled");
});

test("no push subscription means no row and no sleeping workflow run", async ({
  page,
  account: _account,
}) => {
  const restId = `${MARKER}-nosub-${Date.now()}`;
  await page.goto("/");

  // Permission granted but never subscribed, or the subscription was pruned.
  const scheduled = await apiPost(page, "/api/push/schedule", {
    restId,
    delaySeconds: 5,
    exerciseName: "Bench Press",
  });
  expect(scheduled.status).toBe(200);
  expect(scheduled.json?.scheduled).toBe(false);

  // No row at all: a workflow run that can only ever no-op should not exist.
  expect(await restRow(restId)).toBeUndefined();
});

test("another user's rest alert cannot be cancelled or hijacked", async ({
  page,
  account: _account,
}) => {
  const victim = await createTempUser(`${MARKER}-victim`);
  const restId = `${MARKER}-crossuser-${Date.now()}`;
  try {
    await sql`
      insert into rest_notifications (id, user_id, status, exercise_name, fire_at)
      values (${restId}, ${victim.id}::uuid, 'pending', 'Victim Curls', now() + interval '1 hour')`;

    await page.goto("/");
    const subscribed = await apiPost(page, "/api/push/subscribe", fakeSubscription(restId));
    expect(subscribed.status).toBe(200);

    // `restId` is unvalidated client input with no FK, so both writes are
    // owner-scoped. Cancel answers ok either way and must change nothing.
    const cancelled = await apiPost(page, "/api/push/cancel", { restId });
    expect(cancelled.status).toBe(200);
    expect((await restRow(restId))?.status).toBe("pending");

    // Schedule must not steal the row, reassign it, or inject its own label.
    const scheduled = await apiPost(page, "/api/push/schedule", {
      restId,
      delaySeconds: 5,
      exerciseName: "Hijacked",
    });
    expect(scheduled.status).toBe(200);
    expect(scheduled.json?.scheduled).toBe(false);

    const row = await restRow(restId);
    expect(row?.status).toBe("pending");
    expect(row?.user_id).toBe(victim.id);
    expect(row?.exercise_name).toBe("Victim Curls");
  } finally {
    await deleteTempUser(victim.id);
  }
});
