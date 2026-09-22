/**
 * A program ends by itself now, both ways it can end.
 *
 * Nothing ever retired one: `status` had held "completed" as a legal value from
 * the start and no code path wrote it, so a finished block stayed "active"
 * forever. Home and the Routines card kept showing it, FitBot read it as the
 * current plan, and starting that same routine again answered 409 off the
 * partial unique index. The tracker even showed a "Routine complete" toast
 * while the row stayed active.
 *
 * Both endings are asserted against the DATABASE, because the whole defect was
 * that the screen said one thing and the row said another.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { sql } from "./helpers";

async function seedProgram(
  userId: string,
  opts: { name: string; total: number; completed: number; skipped: number; endsIn: string },
) {
  const [routine] = await sql`
    insert into routines (user_id, name, default_duration_days)
    values (${userId}::uuid, ${opts.name}, 28)
    returning id`;
  const [instance] = await sql`
    insert into routine_instances
      (routine_id, user_id, routine_name, start_date, end_date, duration_days,
       total_workouts, completed_workouts, skipped_workouts, status)
    values (${routine.id}, ${userId}::uuid, ${opts.name},
            now() - interval '21 days', now() + ${opts.endsIn}::interval, 28,
            ${opts.total}, ${opts.completed}, ${opts.skipped}, 'active')
    returning id`;
  return { routineId: routine.id as string, instanceId: instance.id as string };
}

const statusOf = async (id: string) =>
  (await sql`select status from routine_instances where id = ${id}`)[0]?.status;

test("skipping the last planned session ends the program", async ({ page, account }) => {
  // One session left, and the user skips it. A skip is a decision about that
  // session, not a debt, so there is nothing left for the program to wait for.
  const { instanceId } = await seedProgram(account.id, {
    name: "ZZ Ending Program",
    total: 5,
    completed: 4,
    skipped: 0,
    endsIn: "7 days",
  });
  const [scheduled] = await sql`
    insert into scheduled_workouts
      (user_id, name, date, exercises, routine_instance_id, routine_day_index)
    values (${account.id}::uuid, 'ZZ Last Session', now() + interval '1 day',
            ${sql.json([{ id: "x", name: "ZZ Move" }])}, ${instanceId}, 5)
    returning id`;

  await page.goto("/");
  expect(await statusOf(instanceId)).toBe("active");

  // In-browser fetch: page.request does not carry the session cookie and would
  // follow the 307 to the login HTML.
  const status = await page.evaluate(async (id) => {
    const res = await fetch(`/api/scheduled-workouts/${id}/skip`, {
      method: "POST",
      credentials: "include",
    });
    return res.status;
  }, scheduled.id as string);
  expect(status).toBe(200);

  await expect.poll(() => statusOf(instanceId)).toBe("completed");
});

test("finishing the last planned session ends the program", async ({ page, account }) => {
  // The path that shows the "Routine complete" toast. The toast was the whole
  // bug in miniature: the app said complete and wrote nothing down.
  const { instanceId } = await seedProgram(account.id, {
    name: "ZZ Finishing Program",
    total: 3,
    completed: 2,
    skipped: 0,
    endsIn: "7 days",
  });
  const [scheduled] = await sql`
    insert into scheduled_workouts
      (user_id, name, date, exercises, routine_instance_id, routine_day_index)
    values (${account.id}::uuid, 'ZZ Final Session', now(),
            ${sql.json([{ id: "x", name: "ZZ Move" }])}, ${instanceId}, 3)
    returning id`;

  await page.goto("/");
  const status = await page.evaluate(async (id) => {
    const res = await fetch("/api/completed-workouts", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayId: `zz-final-${Date.now()}`,
        name: "ZZ Final Session",
        scheduledWorkoutId: id,
        exercises: [
          {
            id: "x",
            name: "ZZ Move",
            instanceId: "zz-0",
            sets: [{ setNumber: 1, weight: 100, reps: 5, completed: true }],
          },
        ],
      }),
    });
    return res.status;
  }, scheduled.id as string);
  expect(status).toBe(201);

  await expect.poll(() => statusOf(instanceId)).toBe("completed");
});

test("a program whose last day has passed with nothing scheduled stops being active", async ({
  page,
  account,
}) => {
  // The common ending: the user simply stopped. Three of five done, the last
  // planned day is behind us, and the calendar is empty, so no future session
  // can arrive to finish the count.
  const { instanceId } = await seedProgram(account.id, {
    name: "ZZ Abandoned Program",
    total: 5,
    completed: 3,
    skipped: 0,
    endsIn: "-20 days",
  });

  await page.goto("/");
  const active = await page.evaluate(async () => {
    const res = await fetch("/api/routine-instances/active", { credentials: "include" });
    return (await res.json()) as Array<{ id: string }>;
  });
  expect(active.map((i) => i.id)).not.toContain(instanceId);

  // Left out of the answer on this render; the row is retired in after().
  await expect.poll(() => statusOf(instanceId)).toBe("completed");
});

test("a program still has its day when a session sits past the end date", async ({
  page,
  account,
}) => {
  // The dates say it is over and the calendar says it is not. The calendar
  // wins: somebody moved a session out past the end and it is still theirs to
  // train, so retiring it here would take a workout off their plan.
  const { instanceId } = await seedProgram(account.id, {
    name: "ZZ Overrunning Program",
    total: 5,
    completed: 3,
    skipped: 0,
    endsIn: "-20 days",
  });
  await sql`
    insert into scheduled_workouts
      (user_id, name, date, exercises, routine_instance_id, routine_day_index)
    values (${account.id}::uuid, 'ZZ Moved Session', now() + interval '3 days',
            ${sql.json([{ id: "x", name: "ZZ Move" }])}, ${instanceId}, 4)`;

  await page.goto("/");
  const active = await page.evaluate(async () => {
    const res = await fetch("/api/routine-instances/active", { credentials: "include" });
    return (await res.json()) as Array<{ id: string }>;
  });
  expect(active.map((i) => i.id)).toContain(instanceId);
  expect(await statusOf(instanceId)).toBe("active");
});
