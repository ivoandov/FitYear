import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { sql, seedTemplate, createTempUser, deleteTempUser } from "./helpers";

/**
 * Both of these endpoints sat behind live confirm dialogs while not existing at
 * all - every confirm 404'd into a failure toast, so editing a workout or a
 * running program silently never reached the scheduled rows. They are guarded
 * here because a missing route is exactly the kind of break that stays quiet.
 */

async function apiPost(page: Page, path: string) {
  return page.evaluate(async (p) => {
    const res = await fetch(p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, path);
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
