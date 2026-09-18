/**
 * Starting a routine schedules the whole duration, not one pass.
 *
 * Until 2026-09-18 the duration only FILTERED entries: starting a 3-day routine
 * "for 4 weeks" created three sessions and left the other 25 days empty. The
 * bug was invisible from the code - every session it did create was correct -
 * and only shows up by counting what lands on the calendar.
 *
 * The second test is the one that matters most. A FitBot program's entries
 * already reach past one rotation, each carrying its own computed target load,
 * so repeating them would duplicate the entire program on top of itself.
 */
import { test, expect } from "@playwright/test";
import { createTempUser, deleteTempUser, seedSettings, applyAuth, sql } from "./helpers";

async function seedRoutine(
  userId: string,
  name: string,
  dayIndexes: number[],
  cycleLength: number | null,
) {
  const [routine] = await sql`
    insert into routines (user_id, name, default_duration_days, cycle_length)
    values (${userId}::uuid, ${name}, 28, ${cycleLength})
    returning id`;
  for (const d of dayIndexes) {
    await sql`
      insert into routine_entries (routine_id, day_index, workout_name, exercises)
      values (${routine.id}, ${d}, ${`Day ${d}`}, ${sql.json([{ name: "ZZ Bench", sets: 3, reps: "5" }])})`;
  }
  return routine.id as string;
}

test("a 3-day routine started for 4 weeks schedules all 4 weeks", async ({ browser }) => {
  const user = await createTempUser("e2e-repeat");
  try {
    await seedSettings(user.id);
    const routineId = await seedRoutine(user.id, "ZZ Repeat Weekly", [1, 3, 5], null);

    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);
    await page.goto("/");

    const res = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/api/routines/${id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ startDate: "2026-10-05T12:00:00.000Z", durationDays: 28 }),
        });
        return { status: r.status, body: await r.json() };
      },
      [routineId],
    );
    expect(res.status).toBe(201);

    const rows = (await sql`
      select date from scheduled_workouts where user_id = ${user.id}::uuid order by date`) as unknown as unknown[];
    // Three training days a week for four weeks.
    expect(rows).toHaveLength(12);

    const [inst] = (await sql`
      select total_workouts from routine_instances where user_id = ${user.id}::uuid`) as unknown as Array<{ total_workouts: number }>;
    // The denominator of every progress readout. Counting the ENTRIES rather
    // than the repeats would leave the program stuck at 25% forever.
    expect(inst.total_workouts).toBe(12);
  } finally {
    await deleteTempUser(user.id);
  }
});

test("a FitBot-shaped program is NOT duplicated", async ({ browser }) => {
  const user = await createTempUser("e2e-norepeat");
  try {
    await seedSettings(user.id);
    // Entries reaching day 29 with a 7-day rotation: already a full program.
    const routineId = await seedRoutine(user.id, "ZZ Full Program", [1, 3, 29], 7);

    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);
    await page.goto("/");

    const res = await page.evaluate(
      async ([id]) => {
        const r = await fetch(`/api/routines/${id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ startDate: "2026-10-05T12:00:00.000Z", durationDays: 35 }),
        });
        return { status: r.status };
      },
      [routineId],
    );
    expect(res.status).toBe(201);

    const rows = (await sql`
      select count(*)::int as n from scheduled_workouts where user_id = ${user.id}::uuid`) as unknown as Array<{ n: number }>;
    // Three entries in, three sessions out.
    expect(rows[0].n).toBe(3);
  } finally {
    await deleteTempUser(user.id);
  }
});

test("a repeat lands one week later, on the same routine day", async ({ browser }) => {
  const user = await createTempUser("e2e-repeat-dates");
  try {
    await seedSettings(user.id);
    const routineId = await seedRoutine(user.id, "ZZ Repeat Dates", [1, 3], null);

    const context = await browser.newContext();
    const page = await context.newPage();
    await applyAuth(context, user.email, user.password);
    await page.goto("/");

    await page.evaluate(
      async ([id]) => {
        await fetch(`/api/routines/${id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ startDate: "2026-10-05T12:00:00.000Z", durationDays: 14 }),
        });
      },
      [routineId],
    );

    const rows = (await sql`
      select to_char(date, 'YYYY-MM-DD') as d, routine_day_index
      from scheduled_workouts where user_id = ${user.id}::uuid order by date`) as unknown as Array<{ d: string; routine_day_index: number }>;

    expect(rows.map((r) => r.d)).toEqual([
      "2026-10-05",
      "2026-10-07",
      "2026-10-12",
      "2026-10-14",
    ]);
    // Every repeat maps back to the SAME routine entry, which is what the
    // plan-versus-actual join and the routine re-sync both match on.
    expect(rows.map((r) => r.routine_day_index)).toEqual([1, 3, 1, 3]);
  } finally {
    await deleteTempUser(user.id);
  }
});
