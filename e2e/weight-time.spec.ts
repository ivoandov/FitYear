/**
 * Net for the weight_time (loaded hold) branch of the set tracker.
 *
 * Ivo, 2026-08-28: "I should also be able to set an exercise as weight and
 * time. Example - pinch plate - 25lbs weight, 60 seconds. neutral hangs -
 * bodyweight (so 0 weight), 45 secs."
 *
 * A hold is the case that breaks a binary exercise-type check: it carries a
 * real LOAD like a lift, and a CLOCK like cardio, and has no reps at all. This
 * asserts the columns it actually needs, and that 0 weight is a legitimate
 * value rather than an empty one.
 */
import { test, expect } from "./fixtures";
import { seedCompletedHold, seedExercise, seedActiveWorkout } from "./helpers";

async function seedHold(accountId: string, name: string, exerciseId: string, iid: string) {
  const displayId = `e2e-wt-${Date.now()}`;
  await seedActiveWorkout(
    accountId,
    {
      id: displayId,
      displayId,
      scheduledWorkoutId: null,
      name: "Hold Test",
      startedAt: new Date(0).toISOString(),
      exercises: [
        {
          id: exerciseId,
          instanceId: iid,
          name,
          muscleGroups: ["Forearms"],
          description: "seeded",
          exerciseType: "weight_time",
          isAssisted: false,
          sets: 1,
          defaultWeight: 0,
          defaultReps: 0,
        },
      ],
    },
    {
      workoutDisplayId: displayId,
      exerciseSets: [
        [iid, [{ setNumber: 1, weight: null, reps: null, distance: null, time: null, completed: false }]],
      ],
      currentExerciseIndex: 0,
      currentSetIndex: 0,
      restTimerDuration: 90,
      weightUnit: "lbs",
    },
  );
}

test("a weight_time exercise tracks a load and a duration, with no reps", async ({
  page,
  account,
}) => {
  const exId = await seedExercise(account.id, `ZZPinch ${Date.now()}`, ["Forearms"], "weight_time");
  await seedHold(account.id, "Plate Pinch", exId, "iid-hold");

  await page.goto("/track");
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();

  // Weight AND time, and crucially NO reps - the combination no other type has.
  await expect(page.getByTestId("input-weight-1")).toBeVisible();
  await expect(page.getByTestId("input-time-1")).toBeVisible();
  await expect(page.getByTestId("input-reps-1")).toHaveCount(0);
  await expect(page.getByTestId("input-distance-1")).toHaveCount(0);

  // The header must name seconds, not reps, or the number means nothing.
  await expect(page.getByText("Time (sec)")).toBeVisible();

  await page.getByTestId("input-weight-1").fill("25");
  await page.getByTestId("input-time-1").fill("60");
  await page.getByTestId("checkbox-complete-1").click();
  await expect(page.getByTestId("checkbox-complete-1")).toBeChecked();
});

test("a BODYWEIGHT hold logs 0 weight as a real value", async ({ page, account }) => {
  // "neutral hangs - bodyweight (so 0 weight), 45 secs". 0 has to survive as a
  // logged load rather than reading as an empty field.
  const exId = await seedExercise(account.id, `ZZHang ${Date.now()}`, ["Back"], "weight_time");
  await seedHold(account.id, "Neutral Hang", exId, "iid-hang");

  await page.goto("/track");
  await expect(page.getByTestId("input-weight-1")).toBeVisible();

  await page.getByTestId("input-weight-1").fill("0");
  await page.getByTestId("input-time-1").fill("45");
  await page.getByTestId("checkbox-complete-1").click();
  await expect(page.getByTestId("checkbox-complete-1")).toBeChecked();
  await expect(page.getByTestId("input-weight-1")).toHaveValue("0");
});

test("beating a previous hold fires a PR", async ({ page, account }) => {
  // A bodyweight hang is 0 lb, which every weight-based PR rule discards, so
  // the duration axis is the only thing that can register a record for it.
  const exId = await seedExercise(account.id, `ZZHold ${Date.now()}`, ["Back"], "weight_time");
  await seedCompletedHold(account.id, exId, "Prior Hang", 0, 45);
  await seedHold(account.id, "Neutral Hang", exId, "iid-pr");

  await page.goto("/track");
  await expect(page.getByTestId("input-time-1")).toBeVisible();

  await page.getByTestId("input-weight-1").fill("0");
  await page.getByTestId("input-time-1").fill("60");
  await page.getByTestId("checkbox-complete-1").click();

  await expect(page.getByText(/new hold PR/i)).toBeVisible({ timeout: 10_000 });
});
