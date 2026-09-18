/**
 * The anatomical muscle map on the workout summary and on Insights.
 *
 * Ivo said yes to one on 2026-09-18, drawn client-side by the MIT package
 * `react-muscle-highlighter` after AscendAPI's paid visualizer was rejected.
 * These assert WHICH regions light and how brightly, through the map's
 * `data-regions` attribute, because that is the part with opinions (specific
 * tags beat coarse ones, sets not pounds, completed sets only); the SVG
 * itself is the package's.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedExercise, sql } from "./helpers";

async function seedWorkout(userId: string, exercises: Array<[string, string[], number]>) {
  const now = new Date();
  const [cw] = await sql`
    insert into completed_workouts (user_id, display_id, name, completed_at, started_at, duration_seconds)
    values (${userId}::uuid, ${`e2e-map-${Date.now()}`}, 'ZZ Map Test', ${now.toISOString()}::timestamp,
            ${new Date(now.getTime() - 3600e3).toISOString()}::timestamp, 3600)
    returning id`;
  let pos = 0;
  for (const [name, muscles, sets] of exercises) {
    const id = await seedExercise(userId, `ZZ ${name}`, muscles);
    const [we] = await sql`
      insert into workout_exercises
        (completed_workout_id, exercise_id, position, name_snapshot, muscle_groups_snapshot, exercise_type, is_assisted)
      values (${cw.id}, ${id}, ${pos++}, ${name}, ${sql.json(muscles)}, 'weight_reps', false)
      returning id`;
    for (let i = 1; i <= sets; i++) {
      await sql`
        insert into workout_sets (workout_exercise_id, set_number, weight_lbs, reps, distance, time, completed)
        values (${we.id}, ${i}, 100, 8, 0, 0, true)`;
    }
    // One prefilled row left unticked: it must not count.
    await sql`
      insert into workout_sets (workout_exercise_id, set_number, weight_lbs, reps, distance, time, completed)
      values (${we.id}, ${sets + 1}, 100, 8, 0, 0, false)`;
  }
  return cw.id as string;
}

test("the summary lights the muscles each exercise named, brightest where most sets went", async ({ page, account }) => {
  const id = await seedWorkout(account.id, [
    // Legs + Quads is a quad exercise: the hamstrings must stay dark.
    ["Back Squat", ["Legs", "Quads", "Glutes"], 5],
    ["Leg Extension", ["Legs", "Quads"], 3],
    ["Bench Press", ["Chest", "Triceps", "Front Delts"], 4],
    ["Calf Raise", ["Calves"], 2],
  ]);
  await page.goto(`/workout-complete/${id}`);
  const map = page.locator("main").getByTestId("muscle-map-summary");
  await expect(map).toBeVisible({ timeout: 20000 });
  await expect(map).toHaveAttribute(
    "data-regions",
    "quadriceps:3 gluteal:2 chest:2 triceps:2 deltoids:2 calves:1",
  );
});

test("insights maps the last 7 days by muscle group, in sets", async ({ page, account }) => {
  await seedWorkout(account.id, [
    ["Bench Press", ["Chest", "Triceps"], 4],
    ["Row", ["Back"], 2],
  ]);
  await page.goto("/insights");
  const map = page.getByTestId("muscle-map-week");
  await expect(map).toBeVisible({ timeout: 20000 });
  // Group-level data, so Back lights the whole back.
  await expect(map).toHaveAttribute(
    "data-regions",
    /^(chest:3 triceps:3|triceps:3 chest:3) (upper-back|trapezius|lower-back):2 (upper-back|trapezius|lower-back):2 (upper-back|trapezius|lower-back):2$/,
  );
  await expect(page.getByTestId("muscle-week-counts")).toContainText("Chest 4");
  await expect(page.getByTestId("muscle-week-counts")).toContainText("Back 2");
});
