import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import { resolve } from "node:path";

// Its own config, and its own testDir, so these never join the durable suite -
// that suite's count is a number people check (59), and a screenshot run is
// slow, writes files, and proves nothing about the app.
//
// Resolved against THIS FILE, not the cwd. A relative "../.env.local" is
// relative to wherever playwright was invoked, so running from webapp/ (which
// is the documented way) looked for it one directory above the repo and the
// helpers then failed with a bare "supabaseUrl is required".
dotenv.config({ path: resolve(__dirname, "../.env.local") });

export default defineConfig({
  testDir: ".",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    screenshot: "off",
  },
  projects: [{ name: "shots" }],
});
