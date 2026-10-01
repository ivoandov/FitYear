/**
 * Three things Ivo asked for on the tracker on 2026-09-30, built together:
 * what he lifted last time, a trend for the exercise, and the rest timer's
 * on/off and duration right on the tracker - with the on/off now stored on
 * the account instead of the browser.
 */
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedExercise, sql } from "./helpers";

/** A completed session with specific sets, `daysAgo` days back. */
async function seedSession(
  userId: string,
  exerciseId: string,
  name: string,
  daysAgo: number,
  sets: Array<[number, number]>,
) {
  const [cw] = await sql`
    insert into completed_workouts (user_id, display_id, name, completed_at)
    values (${userId}::uuid, ${`e2e-tf-${Date.now()}-${Math.random()}`}, ${name},
            now() - (${daysAgo} || ' days')::interval)
    returning id`;
  const [we] = await sql`
    insert into workout_exercises
      (completed_workout_id, exercise_id, position, name_snapshot, muscle_groups_snapshot, exercise_type, is_assisted)
    values (${cw.id}, ${exerciseId}, 0, 'ZZ Feature Press', ${sql.json(["Chest"])}, 'weight_reps', false)
    returning id`;
  for (let i = 0; i < sets.length; i++) {
    await sql`
      insert into workout_sets (workout_exercise_id, set_number, weight_lbs, reps, distance, time, completed)
      values (${we.id}, ${i + 1}, ${sets[i][0]}, ${sets[i][1]}, 0, 0, true)`;
  }
}

async function openTracker(page: Page, userId: string, exercises: Array<{ id: string; name: string; iid: string }>) {
  await seedActiveWorkout(
    userId,
    {
      id: "tf-w",
      displayId: "tf-w",
      name: "ZZ Feature Workout",
      exercises: exercises.map((e) => ({
        id: e.id,
        name: e.name,
        muscleGroups: ["Chest"],
        description: "",
        exerciseType: "weight_reps",
        isAssisted: false,
        instanceId: e.iid,
        sets: 3,
      })),
    },
    null,
  );
  const lastValues = page.waitForResponse(
    (r) => r.url().includes("/api/exercises/last-values") && r.ok(),
  );
  await page.goto("/track");
  await lastValues;
  await expect(page.locator("main").getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });
}

test("the tracker shows every set of the LAST session, in order", async ({ page, account }) => {
  const ex = await seedExercise(account.id, `ZZ Feature Press ${Date.now()}`, ["Chest"]);
  // Two sessions: the older must NOT be what is shown.
  await seedSession(account.id, ex, "ZZ Older", 9, [[95, 10], [95, 10]]);
  await seedSession(account.id, ex, "ZZ Newer", 2, [[135, 8], [135, 8], [135, 6]]);
  await openTracker(page, account.id, [{ id: ex, name: "ZZ Feature Press", iid: "tf-0" }]);

  const line = page.locator("main").getByTestId("text-last-time");
  await expect(line).toBeVisible({ timeout: 20000 });
  await expect(line).toContainText("135 x 8, 135 x 8, 135 x 6 lbs");
  await expect(line).not.toContainText("95");
});

test("a first-ever exercise says it is setting the baseline", async ({ page, account }) => {
  const ex = await seedExercise(account.id, `ZZ Never Done ${Date.now()}`, ["Chest"]);
  await openTracker(page, account.id, [{ id: ex, name: "ZZ Never Done", iid: "tf-1" }]);
  await expect(page.locator("main").getByTestId("text-first-time")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("main").getByTestId("text-last-time")).toHaveCount(0);
  // Nothing to draw yet, so no trend button either.
  await expect(page.locator("main").getByTestId("button-exercise-trend")).toHaveCount(0);
});

test("the trend opens over the tracker, view-only", async ({ page, account }) => {
  const ex = await seedExercise(account.id, `ZZ Trend Press ${Date.now()}`, ["Chest"]);
  await seedSession(account.id, ex, "ZZ One", 14, [[100, 5]]);
  await seedSession(account.id, ex, "ZZ Two", 7, [[110, 5]]);
  await seedSession(account.id, ex, "ZZ Three", 1, [[115, 5]]);
  await openTracker(page, account.id, [{ id: ex, name: "ZZ Trend Press", iid: "tf-2" }]);

  const progress = page.waitForResponse(
    (r) => r.url().includes(`/api/exercises/${ex}/progress`) && r.status() === 200,
  );
  await page.locator("main").getByTestId("button-exercise-trend").click();
  const body = await (await progress).json();
  // Three sessions, oldest first: the same points the exercise page draws.
  expect(body.points).toHaveLength(3);
  expect(body.points.map((p: { bestWeightLbs: number }) => p.bestWeightLbs)).toEqual([100, 110, 115]);

  const sheet = page.getByTestId("sheet-exercise-trend");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Progress")).toBeVisible();
  // View-only: the history correction lives on the exercise page, not here.
  await expect(sheet.getByText(/Treat as kg/i)).toHaveCount(0);
});

test("rest duration can be cleared and retyped, and a preset sets it", async ({ page, account }) => {
  const ex = await seedExercise(account.id, `ZZ Rest Press ${Date.now()}`, ["Chest"]);
  await openTracker(page, account.id, [{ id: ex, name: "ZZ Rest Press", iid: "tf-3" }]);
  const main = page.locator("main");
  const field = main.getByTestId("input-rest-timer");

  // The old field snapped an empty value straight back to 90, so it could
  // never be cleared to type a new number.
  await field.click();
  await field.press("ControlOrMeta+a");
  await field.press("Backspace");
  await expect(field).toHaveValue("");
  await field.pressSequentially("45");
  await expect(field).toHaveValue("45");
  await field.press("Enter");

  await main.getByTestId("button-start-rest-timer").click();
  await expect(page.getByTestId("text-countdown")).toHaveText(/00:4[45]/, { timeout: 10000 });
  await page.getByTestId("button-skip-timer").click();

  await main.getByTestId("button-rest-preset-120").click();
  await expect(field).toHaveValue("120");
});

test("the Auto switch is stored on the account, and a browser choice moves up once", async ({
  page,
  account,
}) => {
  // An existing browser-only choice, from before the setting lived on the account.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("restTimerOnManualComplete", "true");
      sessionStorage.setItem("seeded", "1");
    }
  });
  const ex = await seedExercise(account.id, `ZZ Auto Press ${Date.now()}`, ["Chest"]);
  await openTracker(page, account.id, [{ id: ex, name: "ZZ Auto Press", iid: "tf-4" }]);

  const onAccount = async () =>
    (await sql`select rest_timer_auto_start as v from user_settings where user_id = ${account.id}::uuid`)[0]?.v ?? null;

  // The browser's "true" is pushed up because the account had never been set.
  await expect.poll(onAccount, { timeout: 10000 }).toBe(true);

  const toggle = page.locator("main").getByTestId("switch-auto-rest");
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(onAccount, { timeout: 10000 }).toBe(false);
});
