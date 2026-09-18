/**
 * The tracker holds its card until saved progress has been restored.
 *
 * The restore waits on the settings read, because it needs the real weight
 * unit before converting anything. Until 2026-09-18 the tracker drew defaults
 * in that window: the first exercise, set 1, three blank rows, and an End
 * Workout button that believed nothing was logged. A tap there was overwritten
 * when the restore landed, and End Workout offered to discard a workout that
 * had sets in it. The settings read is held here so the window is wide enough
 * to look into, which is the only way this is observable at all: it is normally
 * served from the persisted cache and lasts a frame.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedExercise } from "./helpers";

test("nothing on the tracker is tappable until saved progress is restored", async ({
  page,
  account,
}) => {
  const first = await seedExercise(account.id, "ZZ Hold First", ["Chest"]);
  const second = await seedExercise(account.id, "ZZ Hold Second", ["Back"]);
  const ex = (id: string, name: string, instanceId: string) => ({
    id,
    name,
    muscleGroups: ["Chest"],
    description: "",
    exerciseType: "weight_reps",
    isAssisted: false,
    instanceId,
    sets: 3,
    defaultWeight: 100,
    defaultReps: 5,
  });
  const sets = (done: number) =>
    [1, 2, 3, 4, 5].map((n) => ({ setNumber: n, weight: 100, reps: 5, completed: n <= done }));

  // Mid-workout: the first exercise finished, the second on its third set.
  await seedActiveWorkout(
    account.id,
    {
      id: "hold-w",
      displayId: "hold-w",
      name: "ZZ Hold Workout",
      exercises: [ex(first, "ZZ Hold First", "hold-0"), ex(second, "ZZ Hold Second", "hold-1")],
    },
    {
      workoutDisplayId: "hold-w",
      exerciseSets: [
        ["hold-0", sets(5)],
        ["hold-1", sets(2)],
      ],
      currentExerciseIndex: 1,
      currentSetIndex: 2,
      restTimerDuration: 90,
    },
  );

  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/user-settings*", async (route) => {
    await held;
    await route.continue();
  });

  await page.goto("/track");
  await expect(page.getByTestId("tracker-restoring")).toBeVisible({ timeout: 20000 });
  // The defaults this used to draw: none of it exists while the read is held.
  await expect(page.getByTestId("text-current-exercise")).toHaveCount(0);
  await expect(page.locator('[data-testid^="checkbox-complete-"]')).toHaveCount(0);
  await expect(page.getByTestId("button-end-workout")).toHaveCount(0);

  release();

  await expect(page.getByTestId("tracker-restoring")).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByTestId("text-current-exercise")).toHaveText("ZZ Hold Second");
  await expect(page.locator('[data-testid^="row-set-"]')).toHaveCount(5);
  await expect(page.getByTestId("row-set-3")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("button-end-workout")).toBeVisible();
});
