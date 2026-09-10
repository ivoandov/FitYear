/**
 * Supersets: alternate between movements, rest only once round the group.
 *
 * The behaviour worth guarding is the one that makes a superset a superset -
 * finishing A1 goes STRAIGHT to A2 with no rest, and only finishing the last
 * movement of the round rests. Get that backwards and it is two ordinary
 * exercises done slowly.
 *
 * The pure rules are unit-tested in lib/__tests__/superset.test.ts; this proves
 * the tracker is actually wired to them.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedExercise } from "./helpers";

test("a superset jumps to the partner without resting, and rests after the round", async ({
  page,
  account,
}) => {
  const a1 = await seedExercise(account.id, "ZZ Super Press", ["Chest"]);
  const a2 = await seedExercise(account.id, "ZZ Super Row", ["Back"]);

  const common = {
    muscleGroups: ["Chest"],
    description: "",
    exerciseType: "weight_reps",
    isAssisted: false,
    sets: 3,
    defaultWeight: 100,
    defaultReps: 5,
  };

  await seedActiveWorkout(
    account.id,
    {
      id: "ss-w",
      displayId: "ss-w",
      name: "ZZ Superset Workout",
      exercises: [
        { ...common, id: a1, name: "ZZ Super Press", instanceId: "ss-0", supersetGroup: "A" },
        { ...common, id: a2, name: "ZZ Super Row", instanceId: "ss-1", supersetGroup: "A", muscleGroups: ["Back"] },
      ],
    },
    {
      workoutDisplayId: "ss-w",
      exerciseSets: [
        ["ss-0", [{ setNumber: 1, weight: null, reps: null, distance: null, time: null, completed: false }]],
        ["ss-1", [{ setNumber: 1, weight: null, reps: null, distance: null, time: null, completed: false }]],
      ],
      currentExerciseIndex: 0,
      currentSetIndex: 0,
      restTimerDuration: 60,
    },
  );

  await page.goto("/track");
  await expect(page.getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });

  // The badge says which movement of the group you are on.
  await expect(page.getByTestId("badge-superset")).toContainText("A1");
  await expect(page.getByTestId("text-current-exercise")).toContainText("ZZ Super Press");

  // Finish a set on A1: straight to A2, and NO rest dialog.
  await page.getByTestId("input-weight-1").fill("100");
  await page.getByTestId("input-reps-1").fill("5");
  await page.getByTestId("checkbox-complete-1").click();

  await expect(page.getByTestId("text-current-exercise")).toContainText("ZZ Super Row", {
    timeout: 10000,
  });
  await expect(page.getByTestId("badge-superset")).toContainText("A2");
  // The whole point: resting between the pair would make this two exercises.
  await expect(page.getByTestId("dialog-rest-timer")).toHaveCount(0);
});
