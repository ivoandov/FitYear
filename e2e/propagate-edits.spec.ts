import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { sql, seedTemplate, createTempUser, deleteTempUser } from "./helpers";

/**
 * Both of these endpoints sat behind live confirm dialogs while not existing at
 * all - every confirm 404'd into a failure toast, so editing a workout or a
 * running program silently never reached the scheduled rows. They are guarded
 * here because a missing route is exactly the kind of break that stays quiet.
 */

async function apiPost(page: Page, path: string, body: unknown = {}) {
  return page.evaluate(
    async ({ p, b }) => {
      const res = await fetch(p, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    { p: path, b: body },
  );
}

async function apiGet(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: "include" });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, path);
}

/**
 * A routine mid-run whose day 3 was just dropped by an edit: entries for days
 * 1 and 2 only, an ACTIVE instance claiming 3 planned sessions, and one
 * upcoming session per day still on the calendar.
 */
async function seedDroppedDayRoutine(userId: string) {
  const [routine] = await sql`
    insert into routines (user_id, name)
    values (${userId}::uuid, ${`ZZ Dropped ${Date.now()}`})
    returning id`;

  for (const day of [1, 2]) {
    await sql`
      insert into routine_entries (routine_id, day_index, workout_name, exercises)
      values (${routine.id}, ${day}, ${`Edited Day ${day}`},
              ${sql.json([{ id: `ex-${day}`, name: `New Exercise ${day}` }])})`;
  }

  const [instance] = await sql`
    insert into routine_instances
      (routine_id, user_id, routine_name, start_date, end_date, duration_days,
       total_workouts, completed_workouts, status)
    values (${routine.id}, ${userId}::uuid, 'ZZ Dropped', now(), now() + interval '7 days',
            7, 3, 0, 'active')
    returning id`;

  const scheduled: Record<number, string> = {};
  for (const day of [1, 2, 3]) {
    const [row] = await sql`
      insert into scheduled_workouts
        (user_id, name, date, exercises, routine_instance_id, routine_day_index)
      values (${userId}::uuid, ${`Old Day ${day}`}, now() + interval '2 days',
              ${sql.json([{ id: "stale", name: "Old Exercise" }])},
              ${instance.id}, ${day})
      returning id`;
    scheduled[day] = row.id;
  }

  return { routineId: routine.id, instanceId: instance.id, scheduled };
}

test("editing a template updates its FUTURE scheduled workouts only", async ({
  page,
  account,
}) => {
  const templateId = await seedTemplate(account.id, `ZZ Propagate ${Date.now()}`);

  // One past and one future scheduled workout, both from this template, each
  // holding the pre-edit exercise.
  const stale = JSON.stringify([{ id: "seed-ex", name: "Old Exercise" }]);
  const [past] = await sql`
    insert into scheduled_workouts (user_id, template_id, name, date, exercises)
    values (${account.id}::uuid, ${templateId}, 'Old Name', now() - interval '3 days', ${stale}::jsonb)
    returning id`;
  const [future] = await sql`
    insert into scheduled_workouts (user_id, template_id, name, date, exercises)
    values (${account.id}::uuid, ${templateId}, 'Old Name', now() + interval '3 days', ${stale}::jsonb)
    returning id`;

  await page.goto("/");
  const res = await apiPost(page, `/api/workout-templates/${templateId}/update-future-scheduled`);
  expect(res.status).toBe(200);
  expect(res.json?.updatedCount).toBe(1);

  const [futureRow] = await sql`
    select name, exercises from scheduled_workouts where id = ${future.id}`;
  const [pastRow] = await sql`
    select name, exercises from scheduled_workouts where id = ${past.id}`;

  // The future row now carries the template's exercise; the past one is a
  // record of what was planned then and must not be rewritten.
  expect(JSON.stringify(futureRow.exercises)).toContain("Bench Press");
  expect(pastRow.name).toBe("Old Name");
  expect(JSON.stringify(pastRow.exercises)).toContain("Old Exercise");
});

test("propagation cannot reach another user's rows sharing the template id", async ({
  page,
  account,
}) => {
  const templateId = await seedTemplate(account.id, `ZZ Scope ${Date.now()}`);
  const victim = await createTempUser("e2e-propagate-victim");
  try {
    // templateId is a plain varchar with no FK, so a row can name someone
    // else's template. Only the caller's row may be rewritten.
    const [mine] = await sql`
      insert into scheduled_workouts (user_id, template_id, name, date, exercises)
      values (${account.id}::uuid, ${templateId}, 'Mine', now() + interval '2 days', '[]'::jsonb)
      returning id`;
    const [theirs] = await sql`
      insert into scheduled_workouts (user_id, template_id, name, date, exercises)
      values (${victim.id}::uuid, ${templateId}, 'Theirs', now() + interval '2 days', '[]'::jsonb)
      returning id`;

    await page.goto("/");
    const res = await apiPost(page, `/api/workout-templates/${templateId}/update-future-scheduled`);
    expect(res.status).toBe(200);
    // Exactly one row updated: the caller's.
    expect(res.json?.updatedCount).toBe(1);

    const [mineRow] = await sql`select name from scheduled_workouts where id = ${mine.id}`;
    const [theirRow] = await sql`select name from scheduled_workouts where id = ${theirs.id}`;
    expect(mineRow.name).not.toBe("Mine");
    expect(theirRow.name).toBe("Theirs");
  } finally {
    await deleteTempUser(victim.id);
  }
});

test("update-active-instances is a no-op when the routine has no active run", async ({
  page,
  account,
}) => {
  const [routine] = await sql`
    insert into routines (user_id, name)
    values (${account.id}::uuid, ${`ZZ Routine ${Date.now()}`})
    returning id`;

  await page.goto("/");
  const res = await apiPost(page, `/api/routines/${routine.id}/update-active-instances`);
  expect(res.status).toBe(200);
  expect(res.json?.updatedCount).toBe(0);

  await sql`delete from routines where id = ${routine.id}`;
});

test("another user's routine cannot be re-synced", async ({ page, account: _account }) => {
  // A routine id that does not belong to the caller must 404, not silently
  // rewrite rows.
  await page.goto("/");
  const res = await apiPost(page, `/api/routines/00000000-0000-0000-0000-000000000000/update-active-instances`);
  expect(res.status).toBe(404);
});

test("a re-sync preview reports the days the edit dropped", async ({ page, account }) => {
  const { routineId } = await seedDroppedDayRoutine(account.id);
  try {
    await page.goto("/");
    const res = await apiGet(page, `/api/routines/${routineId}/update-active-instances`);
    expect(res.status).toBe(200);
    // Days 1 and 2 still exist and take the edit; day 3 no longer does.
    expect(res.json?.updatableCount).toBe(2);
    expect(res.json?.orphanedCount).toBe(1);
    expect(res.json?.orphanedDays).toEqual([3]);
  } finally {
    await sql`delete from routines where id = ${routineId}`;
  }
});

test("a dropped day's session is KEPT unless the user asks for it to go", async ({
  page,
  account,
}) => {
  const { routineId, instanceId, scheduled } = await seedDroppedDayRoutine(account.id);
  try {
    await page.goto("/");
    const res = await apiPost(page, `/api/routines/${routineId}/update-active-instances`);
    expect(res.status).toBe(200);
    expect(res.json?.updatedCount).toBe(2);
    expect(res.json?.removedCount).toBe(0);

    // The surviving days took the edit...
    const [day1] = await sql`select name from scheduled_workouts where id = ${scheduled[1]}`;
    expect(day1.name).toBe("Edited Day 1");

    // ...and the dropped day's session is still there, untouched.
    const [day3] = await sql`select name from scheduled_workouts where id = ${scheduled[3]}`;
    expect(day3.name).toBe("Old Day 3");

    // Nothing was deleted, so the planned count must not move.
    const [inst] = await sql`
      select total_workouts from routine_instances where id = ${instanceId}`;
    expect(inst.total_workouts).toBe(3);
  } finally {
    await sql`delete from routines where id = ${routineId}`;
    await sql`delete from routine_instances where id = ${instanceId}`;
  }
});

test("removeOrphaned deletes the dropped day's sessions and rebases the planned count", async ({
  page,
  account,
}) => {
  const { routineId, instanceId, scheduled } = await seedDroppedDayRoutine(account.id);
  try {
    await page.goto("/");
    const res = await apiPost(page, `/api/routines/${routineId}/update-active-instances`, {
      removeOrphaned: true,
    });
    expect(res.status).toBe(200);
    expect(res.json?.updatedCount).toBe(2);
    expect(res.json?.removedCount).toBe(1);

    const gone = await sql`select id from scheduled_workouts where id = ${scheduled[3]}`;
    expect(gone.length).toBe(0);

    // The surviving days are untouched by the removal.
    const kept = await sql`
      select id from scheduled_workouts where id in (${scheduled[1]}, ${scheduled[2]})`;
    expect(kept.length).toBe(2);

    // total_workouts is the denominator of every progress readout, so a
    // deleted session has to come off it or the program can never reach 100%.
    const [inst] = await sql`
      select total_workouts from routine_instances where id = ${instanceId}`;
    expect(inst.total_workouts).toBe(2);
  } finally {
    await sql`delete from routines where id = ${routineId}`;
    await sql`delete from routine_instances where id = ${instanceId}`;
  }
});
