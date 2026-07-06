import { test, expect } from "@playwright/test";
import {
  createTempUser,
  deleteTempUser,
  seedSettings,
  seedCompletedWorkout,
  applyAuth,
} from "./helpers";

// Week-1 Item 1 regression (the P0): after user A logs out on a shared device,
// user B signing in on the same browser must NOT see A's cached data.
test("logout purges cache so the next user cannot see the previous user's data", async ({
  browser,
}) => {
  const a = await createTempUser("e2e-a");
  const b = await createTempUser("e2e-b");
  const workoutName = `ZZE2E-LEAK-${Date.now()}`;
  try {
    await seedSettings(a.id);
    await seedSettings(b.id);
    await seedCompletedWorkout(a.id, workoutName);

    const context = await browser.newContext();
    const page = await context.newPage();

    // A sees A's workout.
    await applyAuth(context, a.email, a.password);
    await page.goto("/history");
    await expect(page.getByText(workoutName)).toBeVisible();

    // A logs out via the header menu (this triggers the cache purge).
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: /log out/i }).click();
    await page.waitForURL(/\/login/);

    // B signs in on the SAME context (shared localStorage) and must not see A.
    await context.clearCookies();
    await applyAuth(context, b.email, b.password);
    await page.goto("/history");
    await expect(page.getByText(workoutName)).toHaveCount(0);

    await context.close();
  } finally {
    await deleteTempUser(a.id);
    await deleteTempUser(b.id);
  }
});
