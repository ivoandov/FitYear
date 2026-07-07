import { test, expect } from "./fixtures";
import { seedScheduledWorkout, seedTemplate } from "./helpers";

// Net for the home-page card decomposition (Item 8c): the home page renders an
// upcoming scheduled-workout card and a library (template) card, each with a
// dropdown menu. None of this was covered before, so it guards the extraction
// of WorkoutCard / WorkoutCardMenu against structural regressions.
test("home renders scheduled + library cards with working menus", async ({
  page,
  account,
}) => {
  // A few days out at noon -> unambiguously in the "Upcoming" section.
  const future = new Date();
  future.setDate(future.getDate() + 2);
  const dateISO = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")} 12:00:00`;

  const schedName = `ZZUpcoming ${Date.now()}`;
  const tmplName = `ZZLibrary ${Date.now()}`;
  const schedId = await seedScheduledWorkout(account.id, schedName, dateISO);
  const tmplId = await seedTemplate(account.id, tmplName);

  await page.goto("/");

  // Upcoming scheduled-workout card + its menu (Edit/Delete).
  await expect(page.getByTestId(`card-workout-${schedId}`)).toBeVisible();
  await page.getByTestId(`button-workout-menu-${schedId}`).click();
  await expect(page.getByTestId(`button-edit-workout-${schedId}`)).toBeVisible();
  await expect(page.getByTestId(`button-delete-workout-${schedId}`)).toBeVisible();
  await page.keyboard.press("Escape");

  // Library (template) card + its menu (Edit/Delete).
  await expect(page.getByTestId(`card-library-workout-${tmplId}`)).toBeVisible();
  await page.getByTestId(`button-library-workout-menu-${tmplId}`).click();
  await expect(page.getByTestId(`button-edit-library-workout-${tmplId}`)).toBeVisible();
  await expect(page.getByTestId(`button-delete-library-workout-${tmplId}`)).toBeVisible();
});
