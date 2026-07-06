import { test, expect } from "@playwright/test";
import { createTempUser, deleteTempUser, seedSettings, applyAuth } from "./helpers";

// A user whose weight unit is kg should see the tracker weight column labelled
// in kg (guards the lbs<->kg display plumbing).
test("kg weight-unit setting is reflected in the tracker", async ({ browser }) => {
  const user = await createTempUser("e2e-kg");
  try {
    await seedSettings(user.id, "kg");
    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);

    await page.goto("/");
    await page.getByTestId("button-start-workout").click();
    await page.getByTestId("button-add-first-exercise").click();
    await page.getByTestId("input-add-exercise-search").fill("bench");
    await page.locator('[data-testid^="add-exercise-row-"]').first().click();
    await page.getByTestId("button-add-exercises-confirm").click();
    await expect(page.getByTestId("text-current-exercise")).toBeVisible();

    await expect(page.getByText(/Weight \(kg\)/)).toBeVisible();

    await context.close();
  } finally {
    await deleteTempUser(user.id);
  }
});
