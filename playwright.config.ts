import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load local secrets for `npm run e2e` runs. In CI these come from the job env.
dotenv.config({ path: ".env.local" });

const baseURL = process.env.E2E_BASE_URL ?? "https://fityear.flyhi.ai";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Tests create/complete/discard workouts against the shared (prod) database,
  // so run serially to avoid cross-test races and to be gentle on prod.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
