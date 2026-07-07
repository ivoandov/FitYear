import { test, expect } from "./fixtures";
import { seedExercise, seedActiveWorkout } from "./helpers";

// Phase 3 Item 5b: editing a workout must relocate the CURRENT exercise by
// instanceId, not by exercise id. With the same exercise added twice, a
// findIndex-by-id lands on the first occurrence, so the edit jumps to the wrong
// instance. We seed a workout with one exercise twice (distinct weights per
// instance), sit on the SECOND instance, save the editor unchanged, and assert
// we stay on the second instance.
test("editing keeps you on the current instance of a duplicated exercise", async ({
  page,
  account,
}) => {
  const exId = await seedExercise(account.id, `ZZDup ${Date.now()}`, ["Chest"]);

  const iidA = "iid-A";
  const iidB = "iid-B";
  const mkExercise = (instanceId: string) => ({
    id: exId,
    instanceId,
    name: "Dup Exercise",
    muscleGroups: ["Chest"],
    description: "seeded",
    exerciseType: "weight_reps",
    isAssisted: false,
    sets: 3,
    defaultWeight: 135,
    defaultReps: 10,
  });
  const displayId = `e2e-dup-${Date.now()}`;
  const mkSet = (weight: number) => ({
    setNumber: 1,
    weight,
    reps: 5,
    distance: 0,
    time: 0,
    completed: false,
  });

  await seedActiveWorkout(
    account.id,
    {
      id: displayId,
      displayId,
      scheduledWorkoutId: null,
      name: "Dup Test",
      startedAt: new Date(0).toISOString(),
      exercises: [mkExercise(iidA), mkExercise(iidB)],
    },
    {
      workoutDisplayId: displayId,
      exerciseSets: [
        [iidA, [mkSet(111)]],
        [iidB, [mkSet(222)]],
      ],
      currentExerciseIndex: 1, // sitting on the SECOND instance
      currentSetIndex: 0,
      restTimerDuration: 90,
      weightUnit: "lbs",
    },
  );

  await page.goto("/track");

  // Restored on the second instance: its weight is 222 (not the first's 111).
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();
  await expect(page.getByTestId("input-weight-1")).toHaveValue("222");

  // Open the editor and save without changes.
  await page.getByTestId("button-edit-workout").click();
  await page.getByTestId("button-save").click();

  // Still on the second instance (222). The id-based bug would jump to the
  // first instance and show 111.
  await expect(page.getByTestId("input-weight-1")).toHaveValue("222");
});
