/**
 * The coaching read model, and the guard that it stays honest.
 *
 * Two things worth locking down. The endpoint has to be authenticated like
 * every other analytics route (an unauthenticated /api request 307s to the
 * login HTML and `fetch` FOLLOWS it, so a naive test reads a 200 and passes for
 * the wrong reason - hence the `account` fixture even where it looks unused).
 * And the card must stay SILENT for somebody with nothing behind: a nudge that
 * appears every day is furniture within a week.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedExercise, seedCompletedFor } from "./helpers";

test("muscle balance is authenticated and shaped", async ({ page, account }) => {
  const exId = await seedExercise(account.id, "ZZ Balance Press", ["Chest"]);
  await seedCompletedFor(account.id, exId, "ZZ Balance Day", 100, 5);

  await page.goto("/");
  const body = await page.evaluate(async () => {
    const res = await fetch(
      `/api/analytics/muscle-balance?tz=${encodeURIComponent("America/Los_Angeles")}`,
    );
    return { status: res.status, json: await res.json() };
  });

  expect(body.status).toBe(200);
  expect(Array.isArray(body.json.groups)).toBe(true);
  // Every coarse group is present, trained or not, so the caller never has to
  // guess whether an absent group means "untrained" or "query missed it".
  expect(body.json.groups.length).toBe(10);
  for (const g of body.json.groups) {
    expect(typeof g.group).toBe("string");
    expect(["never", "behind", "due", "on-track"]).toContain(g.status);
  }
});

test("Cardio and PT are never reported as behind", async ({ page, account }) => {
  await page.goto("/");
  const json = await page.evaluate(async () => {
    const res = await fetch("/api/analytics/muscle-balance?tz=UTC");
    return res.json();
  });
  const nudged = json.groups.filter(
    (g: { group: string; status: string }) =>
      (g.group === "Cardio" || g.group === "PT") &&
      (g.status === "behind" || g.status === "never"),
  );
  // Somebody who has never logged PT does not have an injury, not a problem.
  expect(nudged).toEqual([]);
});

test("the home card appears exactly when there is a headline", async ({ page, account }) => {
  await page.goto("/");
  const headline = await page.evaluate(async () => {
    const res = await fetch("/api/analytics/muscle-balance?tz=UTC");
    const json = await res.json();
    return json.headline as string | null;
  });

  const card = page.getByTestId("card-muscle-balance");
  if (headline === null) {
    // The silent case, and the one that matters: a nudge shown every day is
    // furniture within a week and gets skipped on the day it is right.
    await expect(card).toHaveCount(0);
  } else {
    expect(headline.length).toBeGreaterThan(0);
    await expect(card.getByTestId("text-balance-headline")).toHaveText(headline);
  }
});
