import { test, expect } from "@playwright/test";

test.describe("auth gate", () => {
  test("unauthenticated / redirects to /login and shows the Google button", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId("button-login")).toBeVisible();
    await expect(page.getByTestId("video-background")).toBeVisible();
  });
});
