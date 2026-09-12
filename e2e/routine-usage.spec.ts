import { test, expect } from "./fixtures";
import { sql, seedTemplate } from "./helpers";

/**
 * `/api/workout-templates/routine-usage` did not exist until 2026-09-11, and
 * nothing noticed. Home queried it on every load; the request fell through to
 * `/api/workout-templates/[id]` (PUT and DELETE only) and answered 405, twice,
 * because React Query retries once. A failed query just leaves the data
 * undefined and the badge renders only when there IS data, so the feature was
 * silently absent rather than broken-looking.
 *
 * This guards the contract AND the route match: a dynamic `[id]` sibling is
 * exactly what swallowed it before.
 */
test("routine-usage answers 200 and names each routine once", async ({ page, account }) => {
  const templateId = await seedTemplate(account.id, `ZZ Usage ${Date.now()}`);
  const [routine] = await sql`
    insert into routines (user_id, name) values (${account.id}::uuid, ${`ZZ Uses Template ${Date.now()}`}) returning id, name`;
  await sql`
    insert into routine_entries (routine_id, day_index, workout_template_id, workout_name)
    values (${routine.id}, 1, ${templateId}, 'Day 1')`;
  // Two days using the same template must still name the routine once.
  await sql`
    insert into routine_entries (routine_id, day_index, workout_template_id, workout_name)
    values (${routine.id}, 3, ${templateId}, 'Day 3')`;
  try {
    await page.goto("/");
    const r = await page.evaluate(async () => {
      const res = await fetch("/api/workout-templates/routine-usage", { credentials: "include" });
      return { status: res.status, body: await res.json() };
    });
    console.log("STATUS:", r.status);
    console.log("BODY:", JSON.stringify(r.body));
    expect(r.status).toBe(200);
    expect(r.body[templateId]).toEqual([routine.name]);
  } finally {
    await sql`delete from routines where id = ${routine.id}`;
  }
});
