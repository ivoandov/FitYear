import { test, expect } from "./fixtures";

test("finish to summary", async ({ page, account: _a }) => {
  await page.goto("/");
  await page.locator("main").getByTestId("button-start-workout").click();
  await expect(page.getByTestId("button-add-first-exercise")).toBeVisible();
  await page.getByTestId("button-add-first-exercise").click();
  await page.getByTestId("input-add-exercise-search").fill("bench");
  await page.locator('[data-testid^="add-exercise-row-"]').first().click();
  await page.getByTestId("button-add-exercises-confirm").click();
  await expect(page.getByTestId("text-current-exercise")).toBeVisible();
  await page.getByTestId("input-weight-1").fill("100");
  await page.getByTestId("input-reps-1").fill("5");
  await page.getByTestId("checkbox-complete-1").click();

  page.on("response", (r) => {
    if (r.url().includes("/api/completed-workouts")) console.log(`  ${r.request().method()} ${r.status()} ${r.url().slice(-45)}`);
  });
  page.on("console", (m) => { if (m.type() === "error") console.log("  CONSOLE " + m.text().slice(0, 160)); });

  const t0 = Date.now();
  await page.getByTestId("button-end-workout").click();
  await page.waitForURL(/\/workout-complete\//, { timeout: 45000 }).catch(() => console.log("  NO NAVIGATION within 45s"));
  console.log(`click -> url ${Date.now() - t0}ms; url now: ${page.url().slice(-45)}`);
  await expect(page.getByTestId("text-workout-name")).toBeVisible({ timeout: 45000 });
  console.log(`click -> summary visible ${Date.now() - t0}ms`);
});
