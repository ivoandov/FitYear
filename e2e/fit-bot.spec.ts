import { test, expect } from "./fixtures";

// Mount + wizard smoke for the Fit Bot page. Does NOT click Generate (that
// spends real Anthropic/LLM budget); it just proves the page renders and the
// step machine advances after the Item 7 rewrite (schema import, new state,
// restructured handlers). The generation/save hardening is covered by types +
// the shared ProgramSchema, not a paid e2e.
test("fit-bot renders and advances a step (no generation)", async ({
  page,
  account,
}) => {
  expect(account.id).toBeTruthy(); // fixture provides an authed session
  await page.goto("/fit-bot");

  await expect(
    page.getByRole("heading", { name: "What's your training focus?" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Strength", exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();

  await expect(
    page.getByRole("heading", { name: "What equipment do you have?" }),
  ).toBeVisible();
});
