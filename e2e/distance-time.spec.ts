import { test, expect } from "./fixtures";
import { seedExercise, seedActiveWorkout } from "./helpers";

// Net for the distance_time branch of the set tracker (untested before). Guards
// the SetRow extraction (Item 8h): a cardio exercise must render distance/time
// inputs and complete a set.
test("distance_time exercise renders distance/time inputs and completes a set", async ({
  page,
  account,
}) => {
  const exId = await seedExercise(account.id, `ZZCardio ${Date.now()}`, ["Cardio"], "distance_time");
  const iid = "iid-cardio";
  const displayId = `e2e-dt-${Date.now()}`;

  await seedActiveWorkout(
    account.id,
    {
      id: displayId,
      displayId,
      scheduledWorkoutId: null,
      name: "Cardio Test",
      startedAt: new Date(0).toISOString(),
      exercises: [
        {
          id: exId,
          instanceId: iid,
          name: "Treadmill",
          muscleGroups: ["Cardio"],
          description: "seeded",
          exerciseType: "distance_time",
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

  await page.goto("/track");
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();

  // Distance/time inputs (not weight/reps) render for this exercise type.
  await expect(page.getByTestId("input-distance-1")).toBeVisible();
  await expect(page.getByTestId("input-time-1")).toBeVisible();
  await expect(page.getByTestId("input-weight-1")).toHaveCount(0);

  await page.getByTestId("input-distance-1").fill("3");
  await page.getByTestId("input-time-1").fill("30");
  await page.getByTestId("checkbox-complete-1").click();
  await expect(page.getByTestId("checkbox-complete-1")).toBeChecked();
});
