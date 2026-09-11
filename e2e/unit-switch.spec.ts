/**
 * Home's controls are addressed through `main` on purpose.
 *
 * Home's first-paint data is server-rendered, so React streams its content:
 * the suspended chunk lands in a `<div hidden>` at the end of the body and is
 * then moved into place. For a few hundred milliseconds BOTH copies are in the
 * DOM, and a bare `getByTestId` matches the hidden one too, failing Playwright
 * strict mode with "resolved to 2 elements". Users never see it - the spare
 * copy is `display: none` - but a selector has to say which tree it means.
 */
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
    await page.locator("main").getByTestId("button-start-workout").click();
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
