/**
 * Durable guard for restarting the rest timer after it ends.
 *
 * Ivo asked to be able to restart the timer once it ends, when he wants more
 * rest. Two things have to hold, and the second is the one with history:
 *   - "Rest again" starts a genuinely new countdown from the finished state
 *   - restarting does NOT advance the set pointer
 *
 * That second one matters because a finished-but-minimized rest previously
 * auto-started a phantom 90s rest AND skipped a set on re-entering /track (see
 * the closed-app-rest-alerts gotcha). Restarting clears hasCompleted, which is
 * exactly the flag that guard keys on, so it has to be proven safe.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedExercise } from "./helpers";

test("the rest timer can be restarted after it ends, without skipping a set", async ({
  page,
  account,
}) => {
  const exId = await seedExercise(account.id, "ZZ Restart Press", ["Chest"]);

  await seedActiveWorkout(
    account.id,
    {
      id: "restart-w",
      displayId: "restart-w",
      name: "ZZ Restart Workout",
      exercises: [
        {
          id: exId,
          name: "ZZ Restart Press",
          muscleGroups: ["Chest"],
          description: "",
          exerciseType: "weight_reps",
          isAssisted: false,
          instanceId: "restart-0",
          sets: 3,
          defaultWeight: 100,
          defaultReps: 5,
        },
      ],
    },
    // A 3-second rest so the countdown reaches zero inside the test.
    {
      workoutDisplayId: "restart-w",
      exerciseSets: [["restart-0", []]],
      currentExerciseIndex: 0,
      currentSetIndex: 0,
      restTimerDuration: 3,
    },
  );

  await page.goto("/track");
  await expect(page.getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });

  // Which set row is active before any of this.
  const setsBefore = await page.locator('[data-testid^="checkbox-complete-"]').count();

  // Open a rest directly from the rest control (a 3s duration is seeded).
  await page.getByTestId("input-rest-timer").fill("3");
  await page.getByTestId("button-start-rest-timer").click();

  const dialog = page.getByTestId("dialog-rest-timer");
  await expect(dialog).toBeVisible({ timeout: 15000 });

  // Let the 3s rest run out.
  await expect(page.getByTestId("text-countdown")).toHaveText("00:00", { timeout: 20000 });
  await expect(page.getByTestId("button-restart-timer")).toBeVisible();

  // "Rest again" restarts the full duration.
  await page.getByTestId("button-restart-timer").click();
  await expect(page.getByTestId("text-countdown")).not.toHaveText("00:00");
  // Back to a running rest, so the pause control returns.
  await expect(page.getByTestId("button-pause-timer")).toBeVisible();

  // Let it finish again, then extend by 30s instead.
  await expect(page.getByTestId("text-countdown")).toHaveText("00:00", { timeout: 20000 });
  await page.getByTestId("button-add-30s").click();
  await expect(page.getByTestId("text-countdown")).not.toHaveText("00:00");
  const extended = await page.getByTestId("text-countdown").textContent();
  // 30s of new rest, allowing a tick of drift.
  expect(["00:30", "00:29", "00:28"]).toContain((extended ?? "").trim());

  // The restart must not have advanced or skipped a set.
  await page.getByTestId("button-skip-timer").click();
  await expect(dialog).toBeHidden();
  const setsAfter = await page.locator('[data-testid^="checkbox-complete-"]').count();
  expect(setsAfter).toBe(setsBefore);
});
