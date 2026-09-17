/**
 * The three doors, and what each one leaves behind.
 *
 * The flow branches now, and the failure mode that matters is invisible to a
 * typecheck: a door that collects the right answers and lands the user in the
 * wrong place, or one that finishes without writing the coach notes the whole
 * redesign exists to produce. Both look like working code.
 *
 * These users deliberately get NO `seedSettings` call - that helper sets
 * `has_completed_onboarding` to true, which is the opposite of what is being
 * tested here. The specs navigate straight to /onboarding rather than relying
 * on the proxy redirect, because the redirect is driven by the `fy_onboarded`
 * cookie written at `/auth/callback`, and the cookie's ABSENCE is deliberately
 * treated as onboarded so migrated users are never stranded.
 */
import { test, expect } from "@playwright/test";
import { createTempUser, deleteTempUser, applyAuth, sql } from "./helpers";

test("the logging door asks one question and lands on Home, not an empty tracker", async ({
  browser,
}) => {
  const user = await createTempUser("e2e-onb-track");
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);

    await page.goto("/onboarding");
    await page.getByTestId("option-door-track").click();

    // Exactly one question: the unit. Anything else here is an interview
    // somebody explicitly asked not to have.
    await page.getByTestId("option-unit-kg").click();
    await page.getByTestId("button-onboarding-next").click();

    // Home, because /track with no active workout is a dead end that sends you
    // back here anyway.
    await page.waitForURL((url) => new URL(url).pathname === "/");
    await expect(page.locator("main").getByTestId("button-start-workout")).toBeVisible();

    const [settings] = await sql`
      select weight_unit, has_completed_onboarding, monthly_workout_goal
      from user_settings where user_id = ${user.id}::uuid`;
    expect(settings.has_completed_onboarding).toBe(true);
    expect(settings.weight_unit).toBe("kg");

    // Nothing was asked about training days, so nothing invented a goal.
    const notes = await sql`select id from coach_notes where user_id = ${user.id}::uuid`;
    expect(notes).toHaveLength(0);
  } finally {
    await deleteTempUser(user.id);
  }
});

test("the coached door writes what it learns into FitBot's memory", async ({ browser }) => {
  const user = await createTempUser("e2e-onb-coach");
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);

    await page.goto("/onboarding");
    await page.getByTestId("option-door-coach").click();

    await page.getByTestId("option-unit-lbs").click();
    await page.getByTestId("button-onboarding-next").click();

    await page.getByTestId("option-days-4").click();
    await page.getByTestId("button-onboarding-next").click();

    await page.getByTestId("option-goal-get-stronger").click();
    await page.getByTestId("button-onboarding-next").click();

    await page.getByTestId("option-equipment-full-gym").click();
    await page.getByTestId("button-onboarding-next").click();

    await page.getByTestId("option-limit-shoulder").click();
    await page.getByTestId("input-limit-text").fill("left shoulder, only overhead");
    await page.getByTestId("button-onboarding-next").click();

    await page.waitForURL((url) => new URL(url).pathname === "/fit-bot");

    const [settings] = await sql`
      select onboarding_days_per_week, monthly_workout_goal, has_completed_onboarding
      from user_settings where user_id = ${user.id}::uuid`;
    expect(settings.has_completed_onboarding).toBe(true);
    expect(settings.onboarding_days_per_week).toBe(4);
    // Derived from days per week rather than left at the default 16, which is
    // the point of not asking the same intention twice.
    expect(settings.monthly_workout_goal).toBe(17);

    const notes = await sql`
      select kind, content, source from coach_notes
      where user_id = ${user.id}::uuid order by kind, content`;

    // The whole reason the redesign exists: FitBot knows these before the
    // user's first message.
    const kinds = notes.map((n) => n.kind);
    expect(kinds).toContain("goal");
    expect(kinds).toContain("constraint");

    // Equipment and the injury are CONSTRAINTS, which is the kind the system
    // prompt renders first and calls a rule. Filing either as a preference
    // would make it something the coach is told it may argue with.
    const constraints = notes.filter((n) => n.kind === "constraint").map((n) => n.content);
    expect(constraints.some((c: string) => c.includes("full gym"))).toBe(true);
    expect(constraints.some((c: string) => c.includes("shoulder issue"))).toBe(true);
    // Free text stored verbatim, not folded into the chip's sentence.
    expect(constraints).toContain("left shoulder, only overhead");

    // Written as the user's own words, which is what stops the model quietly
    // rewriting them later.
    expect(notes.every((n) => n.source === "user")).toBe(true);
  } finally {
    await deleteTempUser(user.id);
  }
});

test("skipping finishes onboarding without inventing anything", async ({ browser }) => {
  const user = await createTempUser("e2e-onb-skip");
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);

    await page.goto("/onboarding");
    await page.getByTestId("option-door-coach").click();
    await page.getByTestId("button-skip-onboarding").click();

    await page.waitForURL((url) => new URL(url).pathname !== "/onboarding");

    const [settings] = await sql`
      select has_completed_onboarding from user_settings where user_id = ${user.id}::uuid`;
    expect(settings.has_completed_onboarding).toBe(true);

    // A skipped setup must never leave FitBot believing something the user
    // never said.
    const notes = await sql`select id from coach_notes where user_id = ${user.id}::uuid`;
    expect(notes).toHaveLength(0);
  } finally {
    await deleteTempUser(user.id);
  }
});
