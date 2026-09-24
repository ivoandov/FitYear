/**
 * Durable guard for the machine-to-machine WRITE door
 * (POST /api/integrations/program, built 2026-09-23 for Liv).
 *
 * Adversarial first, like the schedule spec: this is the one route that lets a
 * shared secret change training data, so the boundary is the point. Then a
 * dry run that must write nothing, and a real program that is created, found
 * in every table it should land in, re-run idempotently, and removed.
 *
 * The key is bound to one real user id (INTEGRATION_USER_ID), so the writes
 * here land on that account. Everything created carries an "E2E Liv" name and
 * is deleted in afterAll; the start date sits two years out so it can never
 * collide with a real session; and it NEVER sends endActive, so a program that
 * person is actually running is never touched. If one is running, the create
 * half is skipped with a message rather than ended.
 */
import { test, expect } from "@playwright/test";
import { sql, closeDb } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const READ_KEY = process.env.INTEGRATION_API_KEY ?? "";
const WRITE_KEY = process.env.INTEGRATION_WRITE_KEY ?? "";
const USER_ID = process.env.INTEGRATION_USER_ID ?? "";
const url = `${BASE}/api/integrations/program`;

const STAMP = Date.now();
const NAME = `E2E Liv program ${STAMP}`;
const DOC_TITLE = `E2E Liv constraints ${STAMP}`;
const NOTE = `E2E Liv note ${STAMP}: read the constraints before planning legs.`;

function farFuture(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 730);
  return d.toISOString().slice(0, 10);
}

const body = (over: Record<string, unknown> = {}) => ({
  routine: {
    name: NAME,
    description: "E2E only. Delete on sight.",
    days: [
      {
        dayIndex: 1,
        workoutName: "E2E Upper",
        exercises: [
          { name: "Push-ups", sets: 3, reps: "8-12", rest: 90 },
          { name: `Zz E2E Invented Movement ${STAMP}`, sets: 2, reps: "AMRAP" },
        ],
      },
      {
        dayIndex: 3,
        workoutName: "E2E Lower",
        exercises: [{ name: "Bulgarian Split Squats", sets: 3, reps: "8", targetLoadLbs: 20 }],
      },
    ],
  },
  start: { startDate: farFuture(), durationDays: 14 },
  document: { title: DOC_TITLE, content: "E2E: no deep squats, isometrics only." },
  note: NOTE,
  ...over,
});

test.describe("integration program door", () => {
  test.afterAll(async () => {
    if (!USER_ID) return;
    const rows = await sql`select id from routines where user_id = ${USER_ID} and name = ${NAME}`;
    for (const r of rows) {
      const inst = await sql`select id from routine_instances where routine_id = ${r.id} and user_id = ${USER_ID}`;
      for (const i of inst) {
        await sql`delete from scheduled_workouts where routine_instance_id = ${i.id} and user_id = ${USER_ID}`;
      }
      await sql`delete from routine_instances where routine_id = ${r.id} and user_id = ${USER_ID}`;
      await sql`delete from routines where id = ${r.id} and user_id = ${USER_ID}`;
    }
    await sql`delete from coach_documents where user_id = ${USER_ID} and title = ${DOC_TITLE}`;
    await sql`delete from coach_notes where user_id = ${USER_ID} and content = ${NOTE}`;
    await sql`delete from exercises where user_id = ${USER_ID} and name ilike ${"%E2E Invented Movement%"}`;
    await closeDb();
  });

  test("rejects a request with no key, and is not a redirect", async ({ request }) => {
    const res = await request.post(url, { data: body() });
    expect(res.status()).toBe(401);
    expect(res.status()).not.toBe(307);
  });

  test("the READ key cannot write", async ({ request }) => {
    test.skip(!READ_KEY, "INTEGRATION_API_KEY not set in this environment");
    const attempts: Array<Record<string, string>> = [
      { "x-fityear-key": READ_KEY },
      { "x-fityear-write-key": READ_KEY },
      { authorization: `Bearer ${READ_KEY}` },
    ];
    for (const headers of attempts) {
      const res = await request.post(url, { headers, data: body() });
      expect(res.status(), JSON.stringify(Object.keys(headers))).toBe(401);
    }
  });

  test("does not reveal which check failed", async ({ request }) => {
    const res = await request.post(url, { headers: { "x-fityear-write-key": "nope" }, data: body() });
    expect(await res.text()).not.toMatch(/length|configured|user|env|INTEGRATION/i);
  });

  test("GET is not a thing here", async ({ request }) => {
    test.skip(!WRITE_KEY, "INTEGRATION_WRITE_KEY not set in this environment");
    const res = await request.get(url, { headers: { "x-fityear-write-key": WRITE_KEY } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("a bad body is refused with a reason and writes nothing", async ({ request }) => {
    test.skip(!WRITE_KEY, "INTEGRATION_WRITE_KEY not set in this environment");
    const bad = body();
    (bad.routine.days as Array<{ dayIndex: number }>)[1].dayIndex = 1;
    const res = await request.post(url, { headers: { "x-fityear-write-key": WRITE_KEY }, data: bad });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("appears twice");
    const rows = await sql`select id from routines where user_id = ${USER_ID} and name = ${NAME}`;
    expect(rows.length).toBe(0);
  });

  test("a dry run returns the plan and writes nothing", async ({ request }) => {
    test.skip(!WRITE_KEY, "INTEGRATION_WRITE_KEY not set in this environment");
    const res = await request.post(url, {
      headers: { "x-fityear-write-key": WRITE_KEY },
      data: body({ dryRun: true }),
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.dryRun).toBe(true);
    expect(json.plan.days.map((d: { dayIndex: number }) => d.dayIndex)).toEqual([1, 3]);
    expect(json.plan.cycleLength).toBe(7);
    // The invented movement matches nothing and would be created; a real one does not.
    expect(json.plan.created.some((n: string) => /E2E Invented Movement/i.test(n))).toBe(true);
    const rows = await sql`select id from routines where user_id = ${USER_ID} and name = ${NAME}`;
    expect(rows.length).toBe(0);
    const docs = await sql`select id from coach_documents where user_id = ${USER_ID} and title = ${DOC_TITLE}`;
    expect(docs.length).toBe(0);
  });

  test("creates the routine, starts it, files the document and the note, and is idempotent", async ({ request }) => {
    test.skip(!WRITE_KEY, "INTEGRATION_WRITE_KEY not set in this environment");
    const running = await sql`select id, routine_name from routine_instances where user_id = ${USER_ID} and status = 'active'`;
    test.skip(
      running.length > 0,
      `a real program is running (${running.map((r) => r.routine_name).join(", ")}); the create half never ends one`,
    );

    const headers = { "x-fityear-write-key": WRITE_KEY };
    const res = await request.post(url, { headers, data: body() });
    expect(res.status(), await res.text()).toBe(201);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.createdCount).toBe(4); // 2 days x 2 weekly repeats over 14 days
    expect(json.endedProgramId).toBeNull();
    expect(json.document?.ok).toBe(true);
    expect(json.note?.ok).toBe(true);

    const routineRows = await sql`select id, cycle_length from routines where user_id = ${USER_ID} and name = ${NAME}`;
    expect(routineRows.length).toBe(1);
    expect(routineRows[0].cycle_length).toBe(7);
    const entries = await sql`select day_index, workout_name from routine_entries where routine_id = ${routineRows[0].id} order by day_index`;
    expect(entries.map((e) => e.day_index)).toEqual([1, 3]);
    const inst = await sql`select id, status, total_workouts from routine_instances where routine_id = ${routineRows[0].id} and user_id = ${USER_ID}`;
    expect(inst.length).toBe(1);
    expect(inst[0].status).toBe("active");
    expect(inst[0].total_workouts).toBe(4);
    const sched = await sql`select id from scheduled_workouts where routine_instance_id = ${inst[0].id} and user_id = ${USER_ID}`;
    expect(sched.length).toBe(4);
    const docs = await sql`select id from coach_documents where user_id = ${USER_ID} and title = ${DOC_TITLE}`;
    expect(docs.length).toBe(1);
    const notes = await sql`select id from coach_notes where user_id = ${USER_ID} and content = ${NOTE}`;
    expect(notes.length).toBe(1);

    // The same call again: the same answer, and still one of everything.
    const again = await request.post(url, { headers, data: body() });
    expect(again.status(), await again.text()).toBe(200);
    const j2 = await again.json();
    expect(j2.alreadyRunning).toBe(true);
    expect(j2.routineInstanceId).toBe(inst[0].id);
    const routineRows2 = await sql`select id from routines where user_id = ${USER_ID} and name = ${NAME}`;
    expect(routineRows2.length).toBe(1);
    const inst2 = await sql`select id from routine_instances where routine_id = ${routineRows[0].id} and user_id = ${USER_ID}`;
    expect(inst2.length).toBe(1);
  });
});
