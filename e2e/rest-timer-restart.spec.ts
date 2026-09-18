/**
 * Durable guard for restarting the rest timer after it ends.
 *
 * Ivo asked to be able to restart the timer once it ends, when he wants more
 * rest. Two things have to hold, and the second is the one with history:
 *   - "Rest again" starts a genuinely new countdown from the finished state
 *   - restarting does NOT advance the set pointer; only "Next Set" does, once
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
    // A 3-second rest so the countdown reaches zero inside the test. FIVE
    // real sets with the pointer on set 2, and both numbers are deliberate.
    // This used to seed an EMPTY set list, which restores as an exercise with
    // no rows at all, while the tracker draws 3 default rows until the saved
    // progress lands. A count taken in that window read 3 and the one after
    // the rest read 0, which is why this failed about one full run in two and
    // passed alone. Five differs from the default three, so seeing five rows
    // proves the restore has landed; and set 2 leaves room above AND below,
    // so an extra advance would show rather than stop at the last set.
    {
      workoutDisplayId: "restart-w",
      exerciseSets: [
        [
          "restart-0",
          [1, 2, 3, 4, 5].map((n) => ({ setNumber: n, weight: 100, reps: 5, completed: n === 1 })),
        ],
      ],
      currentExerciseIndex: 0,
      currentSetIndex: 1,
      restTimerDuration: 3,
    },
  );

  await page.goto("/track");
  await expect(page.getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });

  const rows = page.locator('[data-testid^="row-set-"]');
  const current = page.locator('[data-testid^="row-set-"][data-current]');
  await expect(rows).toHaveCount(5, { timeout: 20000 });
  await expect(current).toHaveCount(1);
  await expect(page.getByTestId("row-set-2")).toHaveAttribute("data-current", "true");

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

  // Two restarts and one "Next Set" move the pointer exactly ONE set, from 2
  // to 3. A restart that also fired the close would land on 4.
  await page.getByTestId("button-skip-timer").click();
  await expect(dialog).toBeHidden();
  await expect(rows).toHaveCount(5);
  await expect(current).toHaveCount(1);
  await expect(page.getByTestId("row-set-3")).toHaveAttribute("data-current", "true");
});
