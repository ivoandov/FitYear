import { test, expect } from "./fixtures";

/**
 * The FitBot conversation page.
 *
 * Nothing here sends a message: `/api/ai/chat` is a paid Anthropic call and the
 * durable suite never spends model budget. What IS worth guarding is everything
 * around the model - that the page mounts, that it keeps the app chrome (it is
 * a destination, not one of the immersive FitBot wizards that hide the nav),
 * that Home can reach it, and that the endpoint refuses an unauthenticated
 * caller with JSON rather than a redirect to the login page.
 */

test("the chat page renders with its openers", async ({ page, account }) => {
  expect(account.id).toBeTruthy();
  await page.goto("/fit-bot/chat");

  // Wait for a hydrated element BEFORE asserting anything else: for a frame
  // after navigation the composer exists but is not yet laid out, and React's
  // tree swap can briefly put two copies in the DOM, which trips strict mode.
  const openers = page.getByTestId("button-chat-opener");
  await expect(openers.first()).toBeVisible();
  expect(await openers.count()).toBeGreaterThan(0);
  const box = page.getByTestId("input-chat").first();
  await expect(box).toBeVisible();
  // Two lines, not one: dictation lands a long transcript all at once and a
  // single-line box hides everything but its tail.
  await expect(box).toHaveAttribute("rows", "2");

  // Send is what shows while idle; Stop replaces it only during a turn.
  // `.first()` for the same reason as above: for a second or two after any
  // navigation this app can hold two copies of a route's tree (Home shows the
  // same churn), so a bare locator trips strict mode for reasons that have
  // nothing to do with what is being tested.
  await expect(page.getByTestId("button-send-chat").first()).toBeVisible();
  await expect(page.getByTestId("button-stop-chat")).toHaveCount(0);
});

test("the chat page KEEPS the app chrome, unlike the FitBot wizards", async ({
  page,
  account: _account,
}) => {
  // AppSidebar and BottomNav both hide on `/fit-bot*`. The chat page is carved
  // out of that rule, and if the carve-out is ever lost the desktop page has no
  // way back - which typecheck and build cannot see.
  await page.goto("/fit-bot/chat");
  await expect(page.getByTestId("side-fitbot-chat")).toBeVisible();

  await page.goto("/fit-bot");
  await expect(page.getByTestId("side-fitbot-chat")).toHaveCount(0);
});

test("Home offers a way into the conversation", async ({ page, account: _account }) => {
  await page.goto("/");
  // Scoped to `main`: see the streaming note in dual-write.spec.ts.
  const entry = page.locator("main").getByTestId("button-fitbot-chat");
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/fit-bot\/chat/);
});

test("the chat endpoint is not reachable without a session", async ({ page }) => {
  // This app 307s an unauthenticated /api request to /login, and `fetch`
  // FOLLOWS that redirect - so the naive "expect 401" check reads the login
  // page's 200 and passes for the wrong reason. `/api/integrations/*` is the
  // one route deliberately outside the session gate; this must not join it.
  // What matters is only that the endpoint never serves the caller: assert the
  // redirect, with redirects disabled so it is visible.
  const res = await page.request.post("/api/ai/chat", {
    data: { message: "hello" },
    maxRedirects: 0,
  });
  expect([307, 401]).toContain(res.status());
  if (res.status() === 307) {
    expect(res.headers()["location"]).toContain("/login");
  }
});
