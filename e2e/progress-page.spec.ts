import { test, expect } from "./fixtures";
import { seedExercise, seedCompletedFor } from "./helpers";

// Phase 4c: the exercise progress page assembles its chart from the normalized
// tables (jsonb fallback). Seed an exercise + a completed workout with it (both
// jsonb and normalized rows), then assert the progress page renders the stats.
test("exercise progress page renders from normalized data", async ({
  page,
  account,
}) => {
  const exName = `ZZProg ${Date.now()}`;
  const exId = await seedExercise(account.id, exName, ["Chest"]);
  await seedCompletedFor(account.id, exId, "prog history", 135, 5);

  await page.goto(`/exercises/${exId}`);

  // Header + the stat strip (only rendered when there are progress points).
  await expect(page.getByRole("heading", { name: exName })).toBeVisible();
  await expect(page.getByText("Workouts", { exact: true })).toBeVisible();
  // Heaviest set was 135 lbs (assembled from the normalized rows).
  await expect(page.getByText("135 lbs").first()).toBeVisible();
  // The chart's metric toggle rendered (proves points exist).
  await expect(page.getByRole("button", { name: "1RM" })).toBeVisible();
});
