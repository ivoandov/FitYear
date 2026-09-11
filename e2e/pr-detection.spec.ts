/**
 * Home's controls are addressed through `main` on purpose.
 *
 * Home's first-paint data is server-rendered, so React streams its content:
 * the suspended chunk lands in a `<div hidden>` at the end of the body and is
 * then moved into place. For a few hundred milliseconds BOTH copies are in the
 * DOM, and a bare `getByTestId` matches the hidden one too, failing Playwright
 * strict mode with "resolved to 2 elements". Users never see it - the spare
 * copy is `display: none` - but a selector has to say which tree it means.
 */
import { test, expect } from "./fixtures";
import { seedExercise, seedCompletedFor } from "./helpers";

// Net for the PR engine (Item 8g). Seed a prior best for an exercise, then in a
// fresh workout log a heavier set and assert the persistent "PR" badge appears.
// Guards the usePrDetection extraction against behavior changes.
test("logging a heavier set than history shows a PR badge", async ({
  page,
  account,
}) => {
  const exName = `ZZPR ${Date.now()}`;
  const exId = await seedExercise(account.id, exName, ["Chest"]);
  // Prior best: 100 lbs x 5.
  await seedCompletedFor(account.id, exId, "PR history", 100, 5);

  await page.goto("/");
  await page.locator("main").getByTestId("button-start-workout").click();
  await expect(page.getByTestId("button-add-first-exercise")).toBeVisible();

  // Add the seeded exercise to the workout (search by its unique name).
  await page.getByTestId("button-add-first-exercise").click();
  await page.getByTestId("input-add-exercise-search").fill(exName);
  await page.locator('[data-testid^="add-exercise-row-"]').first().click();
  await page.getByTestId("button-add-exercises-confirm").click();
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();

  // Log a heavier set: 135 > 100 -> weight PR.
  await page.getByTestId("input-weight-1").fill("135");
  await page.getByTestId("input-reps-1").fill("5");
  await page.getByTestId("checkbox-complete-1").click();

  await expect(page.getByTestId("pr-badge-1")).toBeVisible();
});
