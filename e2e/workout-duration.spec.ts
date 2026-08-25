/**
 * Durable guard for the workout-duration correction.
 *
 * Ivo's report: "sometimes i forget to click finish workout and then do it
 * hours later. fityear then thinks my workout lasted 4 hours, instead of the
 * actual 1." Two halves are covered here:
 *   - the stored duration is SHOWN in History (it was recorded on every
 *     workout and then hardcoded to 0 on the way to the card, so it was
 *     invisible everywhere)
 *   - the duration is editable, and the correction round-trips to the DB,
 *     keeping started_at consistent with it
 *
 * The automatic idle-tail trim itself is unit-tested in
 * src/lib/__tests__/workout-duration.test.ts, since it is pure.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedExercise, sql } from "./helpers";

test("history shows the stored duration and lets the user correct it", async ({ page, account }) => {
  // A workout recorded as 4h that was really about 1h - the exact bad shape.
  const completedAt = new Date();
  const startedAt = new Date(completedAt.getTime() - 4 * 60 * 60 * 1000);

  const exerciseId = await seedExercise(account.id, "ZZ Press", ["Chest"]);
  const [cw] = await sql`
    insert into completed_workouts
      (user_id, display_id, name, completed_at, started_at, duration_seconds)
    values (${account.id}::uuid, ${`e2e-dur-${Date.now()}`}, 'ZZ Duration Test',
            ${completedAt.toISOString()}::timestamp,
            ${startedAt.toISOString()}::timestamp, ${4 * 60 * 60})
    returning id`;
  const workoutId = cw.id as string;
  const [we] = await sql`
    insert into workout_exercises
      (completed_workout_id, exercise_id, position, name_snapshot, muscle_groups_snapshot, exercise_type, is_assisted)
    values (${workoutId}, ${exerciseId}, 0, 'ZZ Press', ${sql.json(["Chest"])}, 'weight_reps', false)
    returning id`;
  await sql`
    insert into workout_sets (workout_exercise_id, set_number, weight_lbs, reps, distance, time, completed)
    values (${we.id}, 1, 100, 5, 0, 0, true)`;

  await page.goto("/history");

  const card = page.locator('[data-testid^="card-history-"]').first();
  await expect(card).toBeVisible({ timeout: 20000 });

  // 1. the duration is actually rendered
  const durationStat = card.locator('[data-testid^="text-history-duration-"]');
  await expect(durationStat).toBeVisible();
  await expect(durationStat).toHaveText("4h");

  // 2. correct it to the real length
  await card.locator('[data-testid^="button-expand-"]').click();
  await card.locator('[data-testid^="button-edit-"]').first().click();

  const input = card.locator('[data-testid^="input-duration-"]');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("4h");
  await input.fill("1h 5m");
  await card.locator('[data-testid^="button-save-edit-"]').click();

  // 3. it round-trips to the database, and started_at follows it
  await expect
    .poll(
      async () => {
        const [row] = await sql`
          select duration_seconds, started_at, completed_at
            from completed_workouts where id = ${workoutId}`;
        return row?.duration_seconds as number;
      },
      { timeout: 20000, message: "duration_seconds should become 3900" },
    )
    .toBe(65 * 60);

  const [row] = await sql`
    select duration_seconds, started_at, completed_at
      from completed_workouts where id = ${workoutId}`;
  const span = Math.round(
    (new Date(row.completed_at as string).getTime() -
      new Date(row.started_at as string).getTime()) /
      1000,
  );
  // started_at must agree with the corrected duration, or the timestamps and
  // duration_seconds tell two different stories.
  expect(span).toBe(65 * 60);
});
