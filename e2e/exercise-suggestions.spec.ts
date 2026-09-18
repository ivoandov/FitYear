/**
 * Standard-name suggestions in the Add Exercise dialog.
 *
 * The reference vocabulary is ~635KB and lives on the SERVER, reached through
 * `/api/exercises/reference`. That route sits beside a dynamic `[id]` sibling,
 * which is the shape that once let a missing route answer 405 for months
 * without anyone noticing - a static segment wins in Next, and this proves it
 * rather than assuming it.
 *
 * The behaviour worth guarding is that a suggestion PREFILLS a canonical name.
 * Getting a standard spelling into the catalog at creation time is the whole
 * point; without it the user types whatever they think of and the naming rules
 * have to repair it afterwards.
 */
import { test, expect } from "@playwright/test";
import { createTempUser, deleteTempUser, seedSettings, applyAuth } from "./helpers";

test("typing an unknown movement offers a standard name, and picking it fills the field", async ({
  browser,
}) => {
  const user = await createTempUser("e2e-suggest");
  try {
    await seedSettings(user.id);
    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);

    await page.goto("/exercises");
    // The DESKTOP add button: the e2e viewport is 1280, and the other one is
    // md:hidden. They carry different testids for exactly this reason.
    await page.getByTestId("button-add-exercise-desktop").click();

    // "Pendlay" is deliberately chosen: it is absent from the public-domain
    // half of the vocabulary and present in the functional half, so this fails
    // if the two sources ever stop being merged.
    await page.getByTestId("input-exercise-name").fill("Pendlay");

    const suggestions = page.getByTestId("standard-name-suggestions");
    await expect(suggestions).toBeVisible();

    const first = suggestions.locator("button").first();
    const suggested = (await first.textContent())?.trim() ?? "";
    expect(suggested.toLowerCase()).toContain("pendlay");

    await first.click();
    await expect(page.getByTestId("input-exercise-name")).toHaveValue(suggested);
  } finally {
    await deleteTempUser(user.id);
  }
});

test("the reference route is reachable and not swallowed by the [id] sibling", async ({
  browser,
}) => {
  const user = await createTempUser("e2e-suggest-api");
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);
    await page.goto("/exercises");

    // Driven in-browser: page.request does not carry the session cookie and
    // would 307 to the login HTML, which reads as a 200 and proves nothing.
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/exercises/reference?q=pendlay", {
        credentials: "include",
      });
      return { status: r.status, body: await r.json() };
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(String(res.body[0].name).toLowerCase()).toContain("pendlay");
  } finally {
    await deleteTempUser(user.id);
  }
});

test("a short query returns nothing rather than most of the vocabulary", async ({
  browser,
}) => {
  const user = await createTempUser("e2e-suggest-short");
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);
    await page.goto("/exercises");

    const res = await page.evaluate(async () => {
      const r = await fetch("/api/exercises/reference?q=pu", { credentials: "include" });
      return r.json();
    });
    // Below three characters a substring search matches most of 4,099 entries
    // in no useful order.
    expect(res).toEqual([]);
  } finally {
    await deleteTempUser(user.id);
  }
});
