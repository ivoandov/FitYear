/**
 * Ivo, 2026-08-28: "It'd be cool to be able to fully pick up a workout later.
 * like pause it, or finish it but then allow the user to recontinue it, add to
 * it, and then finish it again with another summary that takes the two
 * sessions and adds them up."
 *
 * The load-bearing assertion is that resuming does NOT create a second workout.
 * Splitting one session into two rows on the same day would corrupt every
 * count that reads history - streaks, weekly totals, the summary itself.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { completedSetsFor, seedPartialWorkout, sql } from "./helpers";

test("continuing a finished workout keeps ONE workout and adds to it", async ({
  page,
  account,
}) => {
  await seedPartialWorkout(account.id, "ZZ Resume Session");

  const countWorkouts = async () => {
    const [row] = await sql`
      select count(*)::int as n from completed_workouts where user_id = ${account.id}::uuid`;
    return (row as { n: number }).n;
  };
  expect(await countWorkouts()).toBe(1);

  await page.goto("/history");
  const card = page.locator('[data-testid^="card-history-"]').filter({ hasText: "ZZ Resume Session" });
  await card.locator('[data-testid^="button-expand-"]').click();
  await card.locator('[data-testid^="button-continue-"]').click();

  // We are back in the tracker, on the workout we already finished.
  await page.waitForURL(/\/track/);
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();

  // The tracker shows one exercise at a time, so step to the second: the
  // exercise abandoned last time is still here to be finished. Resuming brings
  // back EVERYTHING, unlike repeating, which keeps only what was logged.
  await expect(page.getByTestId("text-current-exercise")).toHaveText("Finished Lift");
  await page.getByTestId("button-next-exercise").click();
  await expect(page.getByTestId("text-current-exercise")).toHaveText("Ran Out Of Time");

  // Log the set that was missed.
  await page.getByTestId("input-weight-1").fill("40");
  await page.getByTestId("input-reps-1").fill("8");
  await page.getByTestId("checkbox-complete-1").click();
  await expect(page.getByTestId("checkbox-complete-1")).toBeChecked();

  // Still exactly ONE workout. Splitting a session into two rows on the same
  // day would corrupt every count that reads history.
  expect(await countWorkouts()).toBe(1);
});

test("the abandoned exercise comes back with its rows still open", async ({ page, account }) => {
  const { workoutId } = await seedPartialWorkout(account.id, "ZZ Resume Rows");

  // Before resuming, nothing is logged against the abandoned lift.
  expect(await completedSetsFor(workoutId, "Ran Out Of Time")).toHaveLength(0);

  await page.goto("/history");
  const card = page.locator('[data-testid^="card-history-"]').filter({ hasText: "ZZ Resume Rows" });
  await card.locator('[data-testid^="button-expand-"]').click();
  await card.locator('[data-testid^="button-continue-"]').click();
  await page.waitForURL(/\/track/);

  // The finished lift's logged set is restored as already complete, so the
  // resumed session shows what was really done rather than a blank slate.
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();
  await expect(page.getByTestId("checkbox-complete-1")).toBeChecked();
});
