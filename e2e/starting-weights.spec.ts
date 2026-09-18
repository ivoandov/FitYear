/**
 * A hand-built routine can carry starting weights and per-exercise rules, and
 * both survive all the way to the calendar.
 *
 * Progressive overload climbs from `targetLoadLbs`, which FitBot programs have
 * and a hand-built routine had no way to set (Ivo, 2026-09-18). This drives the
 * real editor rather than seeding the fields, because the field-to-draft
 * plumbing IS the feature, then checks the whole chain: the stored entry, the
 * scheduled weeks, and the re-sync of the running program.
 *
 * The re-sync half guards a bug found while building this: it copied the
 * routine's exercises verbatim onto every remaining session, so any edit to a
 * running program put every future week back at the STARTING weight.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedExercise, sql } from "./helpers";

type Ex = { name: string; targetLoadLbs?: number; progression?: { incrementLbs: number; everyWeeks: number } };

async function seedRoutine(userId: string) {
  const benchId = await seedExercise(userId, "ZZ Start Bench", ["Chest"]);
  const squatId = await seedExercise(userId, "ZZ Start Squat", ["Legs"]);
  // Template exercises are catalog copies with no sets, reps or weight - which
  // is exactly what a hand-built routine day holds.
  const exercises = [
    { id: benchId, name: "ZZ Start Bench", muscleGroups: ["Chest"], exerciseType: "weight_reps", description: "" },
    { id: squatId, name: "ZZ Start Squat", muscleGroups: ["Legs"], exerciseType: "weight_reps", description: "" },
  ];
  const [tpl] = await sql`
    insert into workout_templates (user_id, name, exercises)
    values (${userId}::uuid, 'ZZ Start Day', ${sql.json(exercises)})
    returning id`;
  const [routine] = await sql`
    insert into routines (user_id, name, default_duration_days, progression)
    values (${userId}::uuid, 'ZZ Starting Weights', 7, ${sql.json({ incrementLbs: 5, everyWeeks: 1 })})
    returning id`;
  await sql`
    insert into routine_entries (routine_id, day_index, workout_template_id, workout_name, exercises)
    values (${routine.id}, 1, ${tpl.id}, 'ZZ Start Day', ${sql.json(exercises)})`;
  return routine.id as string;
}

async function targetsByWeek(userId: string): Promise<Array<Record<string, number | undefined>>> {
  const rows = (await sql`
    select exercises from scheduled_workouts
    where user_id = ${userId}::uuid order by date`) as unknown as Array<{ exercises: Ex[] }>;
  return rows.map((r) =>
    Object.fromEntries(r.exercises.map((e) => [e.name, e.targetLoadLbs])),
  );
}

test("starting weights and an own rule reach every scheduled week", async ({ page, account }) => {
  const routineId = await seedRoutine(account.id);

  await page.goto("/routines");
  await page.getByTestId(`button-routine-menu-${routineId}`).click();
  await page.getByTestId(`button-edit-routine-${routineId}`).click();
  const dialog = page.getByTestId("dialog-routine-builder");
  await expect(dialog).toBeVisible();

  await dialog.getByTestId("button-toggle-weights-1").click();

  // Bench follows the routine's +5 lb a week.
  await dialog.getByTestId("input-start-weight-1-0").fill("135");
  await expect(dialog.getByTestId("text-rule-1-0")).toHaveText("+5 lb every week");

  // Squat gets its own +10 lb every 2 weeks, which REPLACES the routine rule.
  await dialog.getByTestId("input-start-weight-1-1").fill("185");
  await dialog.getByTestId("button-rule-own-1-1").click();
  await dialog.getByTestId("input-own-increment-1-1").fill("10");
  await dialog.getByTestId("input-own-weeks-1-1").fill("2");

  await expect(dialog.getByTestId("button-toggle-weights-1")).toContainText("2/2");
  await dialog.getByTestId("button-save-routine").click();
  await expect(dialog).toBeHidden();

  // 1. Stored on the entry, in pounds, with the rule only where it was chosen.
  await expect
    .poll(async () => {
      const [e] = (await sql`
        select exercises from routine_entries where routine_id = ${routineId}`) as unknown as Array<{ exercises: Ex[] }>;
      return e?.exercises.map((x) => ({ w: x.targetLoadLbs, p: x.progression ?? null }));
    }, { timeout: 15000 })
    .toEqual([
      { w: 135, p: null },
      { w: 185, p: { incrementLbs: 10, everyWeeks: 2 } },
    ]);

  // 2. Start it for four weeks: one session a week, each carrying its climb.
  const res = await page.evaluate(async (id) => {
    const r = await fetch(`/api/routines/${id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ startDate: "2026-10-05T12:00:00.000Z", durationDays: 28 }),
    });
    return r.status;
  }, routineId);
  expect(res).toBe(201);

  const expected = [
    { "ZZ Start Bench": 135, "ZZ Start Squat": 185 },
    { "ZZ Start Bench": 140, "ZZ Start Squat": 185 },
    { "ZZ Start Bench": 145, "ZZ Start Squat": 195 },
    { "ZZ Start Bench": 150, "ZZ Start Squat": 195 },
  ];
  expect(await targetsByWeek(account.id)).toEqual(expected);

  // 3. Re-syncing the running program must keep the climb, not flatten every
  // remaining week back to the starting weight.
  const resync = await page.evaluate(async (id) => {
    const r = await fetch(`/api/routines/${id}/update-active-instances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({}),
    });
    return { status: r.status, body: await r.json() };
  }, routineId);
  expect(resync.status).toBe(200);
  expect(resync.body.updatedCount).toBe(4);
  expect(await targetsByWeek(account.id)).toEqual(expected);
});

test("reopening the editor shows the saved weights and rule", async ({ page, account }) => {
  const routineId = await seedRoutine(account.id);
  const [entry] = (await sql`
    select exercises from routine_entries where routine_id = ${routineId}`) as unknown as Array<{ exercises: Ex[] }>;
  const withWeights = [
    { ...entry.exercises[0], targetLoadLbs: 135 },
    { ...entry.exercises[1], targetLoadLbs: 185, progression: { incrementLbs: 10, everyWeeks: 2 } },
  ];
  await sql`update routine_entries set exercises = ${sql.json(withWeights)} where routine_id = ${routineId}`;

  await page.goto("/routines");
  await page.getByTestId(`button-routine-menu-${routineId}`).click();
  await page.getByTestId(`button-edit-routine-${routineId}`).click();
  const dialog = page.getByTestId("dialog-routine-builder");
  await dialog.getByTestId("button-toggle-weights-1").click();

  await expect(dialog.getByTestId("input-start-weight-1-0")).toHaveValue("135");
  await expect(dialog.getByTestId("input-start-weight-1-1")).toHaveValue("185");
  await expect(dialog.getByTestId("button-rule-own-1-1")).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByTestId("input-own-increment-1-1")).toHaveValue("10");

  // Switching back to the routine rule removes the exercise's own on save.
  await dialog.getByTestId("button-rule-routine-1-1").click();
  await dialog.getByTestId("button-save-routine").click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => {
      const [e] = (await sql`
        select exercises from routine_entries where routine_id = ${routineId}`) as unknown as Array<{ exercises: Ex[] }>;
      return e?.exercises[1]?.progression ?? null;
    }, { timeout: 15000 })
    .toBeNull();
});
