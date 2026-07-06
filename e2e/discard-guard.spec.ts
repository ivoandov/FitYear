import { test, expect } from "./fixtures";
import { completedWorkoutCount } from "./helpers";

// Week-1 Item 2 regression: ending a workout with zero logged sets must prompt
// a discard confirm and must NOT persist a junk completed-workout row.
test("End Workout with nothing logged discards and saves no row", async ({
  page,
  account,
}) => {
  const before = await completedWorkoutCount(account.id);

  await page.goto("/");
  await page.getByTestId("button-start-workout").click();
  await page.getByTestId("button-add-first-exercise").click();
  await page.getByTestId("input-add-exercise-search").fill("bench");
  await page.locator('[data-testid^="add-exercise-row-"]').first().click();
  await page.getByTestId("button-add-exercises-confirm").click();
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();

  // No sets logged -> End Workout should confirm a discard, not save.
  await page.getByTestId("button-end-workout").click();
  await expect(page.getByTestId("dialog-discard-workout")).toBeVisible();
  await page.getByTestId("button-confirm-discard").click();

  // Back home, and no completed-workout row was created.
  await page.waitForURL((url) => new URL(url).pathname === "/");
  expect(await completedWorkoutCount(account.id)).toBe(before);
});
