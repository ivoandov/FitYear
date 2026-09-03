/**
 * The server half of native sign-in.
 *
 * Native sign-in never reaches the server: the app hands an ID token straight
 * to Supabase and the session cookies are written client-side. `/auth/callback`
 * - which is where the web flow stamps `fy_onboarded` - simply does not run.
 * Since `proxy.ts` treats a MISSING cookie as "already onboarded", a brand-new
 * native user would sail straight past onboarding. `/api/auth/native-session`
 * is what closes that hole, and this proves it does.
 *
 * The sign-in itself (the Apple/Google SDK call) can only be exercised on a
 * device; everything the SERVER does about it is testable here.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { sql } from "./helpers";

async function postNativeSession(page: import("@playwright/test").Page, body: unknown) {
  return page.evaluate(async (b) => {
    const res = await fetch("/api/auth/native-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as { onboarded?: boolean; namePersisted?: boolean } | null };
  }, body);
}

function onboardedCookie(cookies: Array<{ name: string; value: string }>) {
  return cookies.find((c) => c.name === "fy_onboarded")?.value;
}

test("stamps fy_onboarded as 0 for a user who has not onboarded", async ({ page, context, account }) => {
  // The fixture's user has no user_settings row, so they have NOT onboarded.
  await sql`delete from user_settings where user_id = ${account.id}::uuid`;

  await page.goto("/");
  const res = await postNativeSession(page, {});
  expect(res.status).toBe(200);
  expect(res.json?.onboarded).toBe(false);

  // "0" is the only value that makes the proxy redirect. A missing cookie means
  // "assume onboarded", which is exactly the bug this route exists to prevent.
  expect(onboardedCookie(await context.cookies())).toBe("0");
});

test("stamps fy_onboarded as 1 once onboarding is complete", async ({ page, context, account }) => {
  await sql`
    insert into user_settings (user_id, has_completed_onboarding)
    values (${account.id}::uuid, true)
    on conflict (user_id) do update set has_completed_onboarding = true`;

  await page.goto("/");
  const res = await postNativeSession(page, {});
  expect(res.status).toBe(200);
  expect(res.json?.onboarded).toBe(true);
  expect(onboardedCookie(await context.cookies())).toBe("1");
});

test("captures the name Apple only ever sends once, and never overwrites it", async ({
  page,
  account,
}) => {
  // A brand-new user has NO profiles row: there is no trigger on auth.users
  // creating one, so the route has to insert rather than update. That is the
  // case Apple's one-time name actually arrives in.
  await sql`delete from profiles where id = ${account.id}::uuid`;

  await page.goto("/");
  const first = await postNativeSession(page, { firstName: "Ada", lastName: "Lovelace" });
  expect(first.status).toBe(200);
  expect(first.json?.namePersisted).toBe(true);

  const [saved] = (await sql`
    select first_name, last_name from profiles where id = ${account.id}::uuid`) as unknown as Array<{
    first_name: string | null;
    last_name: string | null;
  }>;
  expect(saved).toMatchObject({ first_name: "Ada", last_name: "Lovelace" });

  // This route runs on EVERY native sign-in. Apple sends the name once and then
  // never again, so a later call must not clobber a good name with a blank.
  const second = await postNativeSession(page, {});
  expect(second.json?.namePersisted).toBe(false);
  const [after] = (await sql`
    select first_name from profiles where id = ${account.id}::uuid`) as unknown as Array<{
    first_name: string | null;
  }>;
  expect(after.first_name).toBe("Ada");
});

test("refuses an unauthenticated caller", async ({ page }) => {
  // No `account` fixture, so no session. The route must 401 rather than act on
  // a caller it cannot identify. Redirects are NOT followed here, because the
  // proxy answers an unauthenticated /api request with a 307 to /login and
  // following it would read that page's 200 as success.
  await page.goto("/login");
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/auth/native-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      redirect: "manual",
    });
    return res.status;
  });
  expect([0, 307, 401]).toContain(status);
});
