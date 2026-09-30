/**
 * What earns a record toast, per Ivo on 2026-09-30.
 *
 * He kept seeing PRs "when I havent been changing many things". His history
 * explained it: 30 of 47 records in six weeks were the FIRST time he had done
 * an exercise, and each debut fired two toasts (weight and volume). Decided:
 * a first-ever performance is a baseline, not a record; and one toast per
 * exercise per session, weight preferred, "but it's nice when both are tracked
 * and shown in summary" - so this caps the interruption, not the record.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedCompletedFor, seedExercise } from "./helpers";

test("one toast per exercise, weight first, and none for a first-ever exercise", async ({
  page,
  account,
}) => {
  const known = await seedExercise(account.id, `ZZ Known Press ${Date.now()}`, ["Chest"]);
  const fresh = await seedExercise(account.id, `ZZ Brand New Row ${Date.now()}`, ["Back"]);
  // History for ONE of them: 100 x 5 is the best to beat.
  await seedCompletedFor(account.id, known, "ZZ Prior Session", 100, 5);

  const entry = (id: string, name: string, iid: string) => ({
    id,
    name,
    muscleGroups: ["Chest"],
    description: "",
    exerciseType: "weight_reps",
    isAssisted: false,
    instanceId: iid,
    sets: 2,
    defaultWeight: 100,
    defaultReps: 5,
  });
  await seedActiveWorkout(
    account.id,
    {
      id: "pr-w",
      displayId: "pr-w",
      name: "ZZ PR Workout",
      exercises: [entry(known, "ZZ Known Press", "pr-known"), entry(fresh, "ZZ Brand New Row", "pr-fresh")],
    },
    {
      workoutDisplayId: "pr-w",
      exerciseSets: [
        // 110 x 5 beats the best on BOTH weight (100) and volume (500).
        // 120 x 5 would beat them again.
        ["pr-known", [
          { setNumber: 1, weight: 110, reps: 5, completed: false },
          { setNumber: 2, weight: 120, reps: 5, completed: false },
        ]],
        ["pr-fresh", [{ setNumber: 1, weight: 60, reps: 10, completed: false }]],
      ],
      currentExerciseIndex: 0,
      currentSetIndex: 0,
      restTimerDuration: 60,
    },
  );

  // History first, as a person does by lifting before logging. A record needs
  // something to beat, so a set completed before the bests land gets no toast.
  const bests = page.waitForResponse(
    (r) => r.url().includes("/api/exercises/personal-bests") && r.ok(),
  );
  await page.goto("/track");
  await bests;
  const main = page.locator("main");
  await expect(main.getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });
  await expect(main.locator('[data-testid^="row-set-"]')).toHaveCount(2, { timeout: 20000 });

  const weightToasts = page.getByText(/new weight PR/i);
  const volumeToasts = page.getByText(/new volume PR/i);

  // Set 1 earns both records. Exactly one toast shows, and it is the weight one.
  await main.getByTestId("checkbox-complete-1").click();
  await expect(weightToasts).toHaveCount(1, { timeout: 10000 });
  await expect(volumeToasts).toHaveCount(0);

  // Set 2 beats it again. This exercise has had its toast for the session.
  await main.getByTestId("checkbox-complete-2").click();
  await expect(main.getByTestId("checkbox-complete-2")).toBeChecked();
  await page.waitForTimeout(1500);
  await expect(weightToasts).toHaveCount(1);
  await expect(volumeToasts).toHaveCount(0);

  // The brand-new exercise: its first set is a baseline, so no toast at all.
  await main.getByTestId("button-next-exercise").click();
  await expect(main.getByTestId("text-current-exercise")).toContainText("ZZ Brand New Row");
  await main.getByTestId("checkbox-complete-1").click();
  await expect(main.getByTestId("checkbox-complete-1")).toBeChecked();
  await page.waitForTimeout(1500);
  await expect(page.getByText(/ZZ Brand New Row - new/i)).toHaveCount(0);
});

test("a set prefills from what was lifted last time", async ({ page, account }) => {
  // The other half of the same 404: `/api/exercises/last-values` was fetched
  // at a path that does not exist, so for nineteen days no set prefilled from
  // the last session. No progress is seeded here, so the first rows come from
  // the prefill and nothing else.
  const ex = await seedExercise(account.id, `ZZ Prefill Press ${Date.now()}`, ["Chest"]);
  await seedCompletedFor(account.id, ex, "ZZ Last Time", 135, 8);
  await seedActiveWorkout(
    account.id,
    {
      id: "prefill-w",
      displayId: "prefill-w",
      name: "ZZ Prefill Workout",
      exercises: [
        {
          id: ex,
          name: "ZZ Prefill Press",
          muscleGroups: ["Chest"],
          description: "",
          exerciseType: "weight_reps",
          isAssisted: false,
          instanceId: "prefill-0",
          sets: 3,
        },
      ],
    },
    null,
  );

  await page.goto("/track");
  const main = page.locator("main");
  await expect(main.getByTestId("text-current-exercise")).toBeVisible({ timeout: 20000 });
  await expect(main.getByTestId("input-weight-1")).toHaveValue("135", { timeout: 20000 });
});
