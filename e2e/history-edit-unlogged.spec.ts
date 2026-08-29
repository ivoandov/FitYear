/**
 * Durable guard for editing an exercise you ran out of time for.
 *
 * Ivo, 2026-08-28: "In today's workout, I only had time for 2 out of the 6+
 * exercises, so I finished that workout, then an hour later I wanted to do a
 * couple more... when I went to edit the workout and add the reps and weight it
 * didnt really save or update in the exercises that had zero sets recorded."
 *
 * The rows were NOT missing. An abandoned exercise keeps its prefilled rows
 * with `completed=false`, the editor showed them, and the save preserved that
 * flag - so the edit round-tripped as a still-unlogged set, disappeared from
 * the card (which lists completed sets only) and changed nothing.
 *
 * Typing a value now logs that row, while rows the user never touches stay
 * unlogged - the distinction that keeps an untouched prefill from inflating the
 * workout, which is a regression this codebase has already had once.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { completedSetsFor, seedPartialWorkout } from "./helpers";

test("editing an abandoned exercise logs it, and it survives to the DB", async ({
  page,
  account,
}) => {
  const { workoutId } = await seedPartialWorkout(account.id, "ZZ Partial Session");

  // Nothing is logged against the abandoned lift to begin with.
  expect(await completedSetsFor(workoutId, "Ran Out Of Time")).toHaveLength(0);

  await page.goto("/history");
  const card = page.locator('[data-testid^="card-history-"]').filter({ hasText: "ZZ Partial Session" });
  await expect(card).toBeVisible();
  await card.locator('[data-testid^="button-expand-"]').click();

  // The abandoned exercise is hidden in view mode (no completed sets)...
  await expect(card.getByText("Ran Out Of Time")).toBeHidden();
  // ...and appears once editing, so it can be filled in.
  await card.locator('[data-testid^="button-edit-"]').click();
  await expect(card.getByText("Ran Out Of Time")).toBeVisible();

  // Exercise index 1 is the abandoned one, set row 0.
  const weight = card.locator('[data-testid$="-1-0"][data-testid^="input-weight-"]');
  const reps = card.locator('[data-testid$="-1-0"][data-testid^="input-reps-"]');
  await weight.fill("40");
  await reps.fill("8");
  await card.locator('[data-testid^="button-save-edit-"]').click();

  // The set is now genuinely logged, at the values typed.
  await expect
    .poll(async () => await completedSetsFor(workoutId, "Ran Out Of Time"), { timeout: 15_000 })
    .toEqual([{ weight: 40, reps: 8 }]);

  // The row the user never touched stayed unlogged, so the workout was not
  // inflated by the edit.
  const logged = await completedSetsFor(workoutId, "Ran Out Of Time");
  expect(logged).toHaveLength(1);

  // And it now shows on the card without editing.
  await expect(card.getByText("Ran Out Of Time")).toBeVisible();
});
