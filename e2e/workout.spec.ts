import { test, expect } from "./fixtures";
import { sql } from "./helpers";

async function addFirstExercise(page: import("@playwright/test").Page, search: string) {
  await page.getByTestId("button-add-first-exercise").click();
  await page.getByTestId("input-add-exercise-search").fill(search);
  await page.locator('[data-testid^="add-exercise-row-"]').first().click();
  await page.getByTestId("button-add-exercises-confirm").click();
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();
}

test("quick-start: log a set, auto-name on complete, rename persists", async ({
  page,
  account,
}) => {
  await page.goto("/");
  await page.getByTestId("button-start-workout").click();
  await expect(page.getByTestId("button-add-first-exercise")).toBeVisible();
  await addFirstExercise(page, "bench");

  // Log one set.
  await page.getByTestId("input-weight-1").fill("100");
  await page.getByTestId("input-reps-1").fill("5");
  await page.getByTestId("checkbox-complete-1").click();

  // Finish -> workout-complete with an auto-derived (non-empty) name.
  await page.getByTestId("button-end-workout").click();
  await expect(page).toHaveURL(/\/workout-complete\//);
  const nameEl = page.getByTestId("text-workout-name");
  await expect(nameEl).toBeVisible();
  await expect(nameEl).not.toHaveText("");

  // Rename via the inline editor.
  const newName = `E2E Renamed ${Date.now()}`;
  await page.getByTestId("button-edit-workout-name").click();
  const input = page.getByTestId("input-workout-name");
  await expect(input).toBeVisible();
  await input.fill(newName);
  await page.getByTestId("button-save-workout-name").click();
  await expect(page.getByTestId("text-workout-name")).toHaveText(newName);

  // Rename persists server-side.
  await expect
    .poll(
      async () => {
        const rows = await sql`
          select name from completed_workouts
          where user_id = ${account.id}::uuid
          order by completed_at desc limit 1`;
        return rows[0]?.name ?? null;
      },
      { timeout: 15_000 },
    )
    .toBe(newName);
});
