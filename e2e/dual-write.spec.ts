import { test, expect } from "./fixtures";
import { sql } from "./helpers";

// Phase 4a parity net: completing a workout must mirror into the normalized
// workout_exercises / workout_sets tables (best-effort dual-write). Confirms
// the dual-write path produces rows that match the jsonb.
test("completing a workout dual-writes matching normalized rows", async ({
  page,
  account,
}) => {
  await page.goto("/");
  await page.getByTestId("button-start-workout").click();
  await expect(page.getByTestId("button-add-first-exercise")).toBeVisible();
  await page.getByTestId("button-add-first-exercise").click();
  await page.getByTestId("input-add-exercise-search").fill("bench");
  await page.locator('[data-testid^="add-exercise-row-"]').first().click();
  await page.getByTestId("button-add-exercises-confirm").click();
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();

  await page.getByTestId("input-weight-1").fill("135");
  await page.getByTestId("input-reps-1").fill("5");
  await page.getByTestId("checkbox-complete-1").click();
  await page.getByTestId("button-end-workout").click();
  await expect(page).toHaveURL(/\/workout-complete\//);

  // Normalized rows exist for the just-saved workout.
  await expect
    .poll(
      async () => {
        const [cw] = await sql`
          select id from completed_workouts
          where user_id = ${account.id}::uuid
          order by completed_at desc limit 1`;
        if (!cw) return 0;
        const rows = await sql`
          select ws.id from workout_sets ws
          join workout_exercises we on we.id = ws.workout_exercise_id
          where we.completed_workout_id = ${cw.id}`;
        return rows.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  // The logged set (135 x 5, completed) is present in the normalized rows.
  const [cw] = await sql`
    select id from completed_workouts
    where user_id = ${account.id}::uuid
    order by completed_at desc limit 1`;
  const completedSets = await sql`
    select ws.weight_lbs, ws.reps, ws.completed from workout_sets ws
    join workout_exercises we on we.id = ws.workout_exercise_id
    where we.completed_workout_id = ${cw.id} and ws.completed = true`;
  const match = completedSets.find(
    (r) => Number(r.weight_lbs) === 135 && Number(r.reps) === 5,
  );
  expect(match).toBeTruthy();
});
