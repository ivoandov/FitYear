/**
 * The tracking flow, reworked 2026-09-30 from Ivo's run through it.
 *
 * "We start with 3 sets but when I finish the third one, a fourth one doesn't
 * get added automatically... 'Finish exercise' button doesnt show up until 3
 * sets are completed - what if I want to finish with only two sets or I am
 * doing a 1RM? ... I also wish I could add a new exercise to the database from
 * the 'Add Exercise' menu if I dont see what I want."
 *
 * Nothing in the suite drove Finish or Add Set before this file.
 */
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedExercise, sql } from "./helpers";

async function track(
  page: Page,
  userId: string,
  exercises: Array<{ id: string; name: string; iid: string }>,
  opts: { autoRest?: boolean } = {},
) {
  if (opts.autoRest) {
    await page.addInitScript(() => localStorage.setItem("restTimerOnManualComplete", "true"));
  }
  await seedActiveWorkout(
    userId,
    {
      id: "flow-w",
      displayId: "flow-w",
      name: "ZZ Flow Workout",
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
    {
      workoutDisplayId: "flow-w",
      exerciseSets: exercises.map((e) => [
        e.iid,
        [1, 2, 3].map((n) => ({ setNumber: n, weight: 100, reps: 5, completed: false })),
      ]),
      currentExerciseIndex: 0,
      currentSetIndex: 0,
      restTimerDuration: 3,
    },
  );
  await page.goto("/track");
  const main = page.locator("main");
  await expect(main.getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });
  await expect(main.locator('[data-testid^="row-set-"]')).toHaveCount(3, { timeout: 20000 });
  return main;
}

test("finish appears after ONE set, and finishing early saves only what was done", async ({
  page,
  account,
}) => {
  const ex = await seedExercise(account.id, `ZZ One Rep Max ${Date.now()}`, ["Legs"]);
  const main = await track(page, account.id, [{ id: ex, name: "ZZ One Rep Max", iid: "f-0" }]);

  // Nothing done yet: nothing to finish.
  await expect(main.getByTestId("button-primary-action")).toHaveCount(0);

  // One heavy single - a 1RM attempt - and that is the exercise done.
  await main.getByTestId("checkbox-complete-1").click();
  await expect(main.getByTestId("button-primary-action")).toHaveText(/Finish Workout/);
  await expect(main.getByTestId("text-sets-done")).toHaveText(/1 of 3 sets done/);

  await main.getByTestId("button-primary-action").click();
  await page.waitForURL(/\/workout-complete\//, { timeout: 20000 });

  // Saved with exactly the one completed set counting; the two untouched rows
  // stay incomplete, which every total in the app already ignores.
  const [row] = await sql`
    select count(*) filter (where ws.completed)::int as done, count(*)::int as total
    from completed_workouts cw
    join workout_exercises we on we.completed_workout_id = cw.id
    join workout_sets ws on ws.workout_exercise_id = we.id
    where cw.user_id = ${account.id}::uuid and cw.display_id = 'flow-w'`;
  expect(row.done).toBe(1);
});

test("add set is always there, says 'one more' when all are done, and the last can be taken back", async ({
  page,
  account,
}) => {
  const ex = await seedExercise(account.id, `ZZ Extra Set ${Date.now()}`, ["Chest"]);
  const main = await track(page, account.id, [{ id: ex, name: "ZZ Extra Set", iid: "f-1" }]);
  const rows = main.locator('[data-testid^="row-set-"]');

  // Available before anything is done, not only after.
  await expect(main.getByTestId("button-add-set")).toHaveText(/Add set/);
  await main.getByTestId("button-add-set").click();
  await expect(rows).toHaveCount(4);
  // ...and the unwanted fourth can be removed while it is unchecked.
  await main.getByTestId("button-remove-set").click();
  await expect(rows).toHaveCount(3);

  for (const n of [1, 2, 3]) await main.getByTestId(`checkbox-complete-${n}`).click();
  await expect(main.getByTestId("button-add-set")).toHaveText(/One more set/);
  // Every row is logged, so there is nothing to take back.
  await expect(main.getByTestId("button-remove-set")).toHaveCount(0);

  await main.getByTestId("button-add-set").click();
  await expect(rows).toHaveCount(4);
  // Prefilled from the last row, not blank.
  await expect(main.getByTestId("input-weight-4")).toHaveValue("100");
});

test("no rest timer after the final set of the workout", async ({ page, account }) => {
  const ex = await seedExercise(account.id, `ZZ Last Set ${Date.now()}`, ["Back"]);
  const main = await track(page, account.id, [{ id: ex, name: "ZZ Last Set", iid: "f-2" }], {
    autoRest: true,
  });
  const dialog = page.getByTestId("dialog-rest-timer");

  // Sets 1 and 2 are followed by a rest, as before.
  for (const n of [1, 2]) {
    await main.getByTestId(`checkbox-complete-${n}`).click();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await page.getByTestId("button-skip-timer").click();
    await expect(dialog).toBeHidden();
  }
  // The last set of the last exercise: the next tap is Finish, not a rest.
  await main.getByTestId("checkbox-complete-3").click();
  await expect(main.getByTestId("button-primary-action")).toHaveText(/Finish Workout/);
  await page.waitForTimeout(1500);
  await expect(dialog).toBeHidden();
});

test("an exercise that is not in the list can be created from Add Exercise", async ({
  page,
  account,
}) => {
  const ex = await seedExercise(account.id, `ZZ Starting Lift ${Date.now()}`, ["Chest"]);
  const main = await track(page, account.id, [{ id: ex, name: "ZZ Starting Lift", iid: "f-3" }]);
  const unique = `ZZ Brand New Movement ${Date.now()}`;

  await main.getByTestId("button-add-exercise").click();
  await page.getByTestId("input-add-exercise-search").fill(unique);
  await page.getByTestId("button-create-exercise-from-search").click();

  // The create form, seeded with what was typed.
  await expect(page.getByTestId("input-exercise-name")).toHaveValue(unique);
  await page.getByTestId("checkbox-muscle-back").click();
  await page.getByTestId("button-save-exercise").click();

  // Straight into the workout, and current: no second "now add it" step.
  await expect(main.getByTestId("text-current-exercise")).toContainText("Brand New Movement", {
    timeout: 20000,
  });
  const created = await sql`select id, image_url from exercises where name ilike ${"%Brand New Movement%"} and user_id = ${account.id}::uuid`;
  expect(created).toHaveLength(1);
  // Imageless on purpose: generating one is paid, and Ivo stopped that.
  await page.waitForTimeout(1500);
  const [after] = await sql`select image_url from exercises where id = ${created[0].id}`;
  expect(after.image_url).toBeNull();
});
