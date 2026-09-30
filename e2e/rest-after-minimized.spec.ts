/**
 * A completed set always earns a new rest, even after one was minimized.
 *
 * Ivo, 2026-09-30: "my 90s timer stopped working halfway through my workout
 * yesterday. not sure why." This is why. Asking for a rest used to mean setting
 * the tracker's state to "resting" - but a minimized rest keeps it there (the
 * restore effect pins it while the pill is up), and a setState to the value it
 * already holds fires no effect. So the first minimized rest silently disabled
 * the rest timer for the remainder of the session.
 *
 * The sequence below is his: rest, minimize, let it run out, log another set.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedExercise } from "./helpers";

test("a set completed after a minimized rest starts a new countdown", async ({
  page,
  account,
}) => {
  const exId = await seedExercise(account.id, "ZZ Minimized Press", ["Chest"]);
  await seedActiveWorkout(
    account.id,
    {
      id: "min-w",
      displayId: "min-w",
      name: "ZZ Minimized Workout",
      exercises: [
        {
          id: exId,
          name: "ZZ Minimized Press",
          muscleGroups: ["Chest"],
          description: "",
          exerciseType: "weight_reps",
          isAssisted: false,
          instanceId: "min-0",
          sets: 4,
          defaultWeight: 100,
          defaultReps: 5,
        },
      ],
    },
    {
      workoutDisplayId: "min-w",
      // Four real sets so there is always another one to complete, and a 3s
      // rest so it runs out inside the test.
      exerciseSets: [
        [
          "min-0",
          [1, 2, 3, 4].map((n) => ({ setNumber: n, weight: 100, reps: 5, completed: false })),
        ],
      ],
      currentExerciseIndex: 0,
      currentSetIndex: 0,
      restTimerDuration: 3,
    },
  );

  // "Start the rest timer when I complete a set" is a per-browser setting,
  // off by default. Ivo runs with it on, which is the only way a completed set
  // asks for a rest at all.
  await page.addInitScript(() => {
    localStorage.setItem("restTimerOnManualComplete", "true");
  });
  await page.goto("/track");
  const main = page.locator("main");
  await expect(main.getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });

  // Set 1: completing it starts the rest.
  await main.getByTestId("checkbox-complete-1").click();
  const dialog = page.getByTestId("dialog-rest-timer");
  await expect(dialog).toBeVisible({ timeout: 15000 });

  // Minimize it, then let it run out while minimized - the state Ivo was in.
  await page.getByTestId("button-minimize-timer").click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("pill-rest-timer-minimized")).toBeVisible();
  // The pill reads "Done!" once a minimized rest has run out.
  await expect(page.getByTestId("text-pill-countdown")).toHaveText("Done!", { timeout: 20000 });

  // Set 2: this is the one that used to get nothing at all.
  await main.getByTestId("checkbox-complete-2").click();
  await expect(dialog).toBeVisible({ timeout: 15000 });
  // A NEW countdown, not the finished one adopted: it is counting, and the
  // pause control is only there while a rest is actually running.
  await expect(page.getByTestId("text-countdown")).not.toHaveText("00:00");
  await expect(page.getByTestId("button-pause-timer")).toBeVisible();
});
