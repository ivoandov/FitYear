/**
 * One-shot fix: Ivo's program started a day early, so move it one day later.
 *
 * FitBot proposed starting "Advanced Hypertrophy Fusion" on 2026-10-02 and Ivo
 * approved it, but the start route parsed the bare day as midnight UTC, which
 * is Oct 1 in Los Angeles: the instance began Oct 1 and Day 1 was past due on
 * arrival. He then approved "move Day 2 from Oct 3 to Oct 4", which the same
 * bug wrote back onto Oct 3. Both are fixed in code (`609e345`); this puts his
 * existing program where he approved it. Ivo, 2026-10-03: "do it".
 *
 * Every still-scheduled session of the instance moves +1 day, and so do the
 * instance's start and end, so the program's week numbering (which progression
 * reads from the start) stays aligned. Completed sessions are history and are
 * not touched: Day 1 was trained on Oct 2, which is the day it belongs to.
 *
 * House pattern: dry run by default, `--apply` to execute, gitignored JSON
 * backup, one transaction, precondition and post checks. NOT idempotent by
 * nature (each run shifts again), so it refuses once the start already reads
 * 2026-10-02.
 *
 * NOT done here: the one Google Calendar event (Day 2 - Push, created on Oct 3
 * by the failed move). Patching it needs the Google OAuth client credentials,
 * which exist only in Vercel. Ivo drags it from Oct 3 to Oct 4 by hand.
 */
import postgres from "postgres";
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

config({ path: path.join(__dirname, "..", ".env.local") });

const INSTANCE_ID = "50147185-1e9c-4de2-80d4-663ec08945f4";
const EXPECTED_USER_EMAIL = "thebballkid@gmail.com";
const EXPECTED_START = "2026-10-01";
const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const [instance] = await sql`
      select ri.*, to_char(ri.start_date, 'YYYY-MM-DD') as start_key, u.email
      from routine_instances ri join auth.users u on u.id = ri.user_id
      where ri.id = ${INSTANCE_ID}`;
    if (!instance) throw new Error("instance not found - aborting");
    if (instance.email !== EXPECTED_USER_EMAIL) throw new Error(`instance belongs to ${instance.email} - aborting`);
    if (instance.start_key === "2026-10-02") {
      console.log("Start already reads 2026-10-02. 0 changes (already applied).");
      return;
    }
    if (instance.start_key !== EXPECTED_START) throw new Error(`start is ${instance.start_key}, expected ${EXPECTED_START} - aborting`);
    if (instance.status !== "active") throw new Error(`instance is ${instance.status} - aborting`);

    const sessions = await sql`
      select id, name, to_char(date, 'YYYY-MM-DD') as day_key, calendar_event_id
      from scheduled_workouts where routine_instance_id = ${INSTANCE_ID} order by date`;
    // Nothing may already sit on a day a session is moving onto, other than a
    // session of this same program that is itself moving.
    const clashes = await sql`
      select to_char(other.date, 'YYYY-MM-DD') as day_key, other.name
      from scheduled_workouts other
      where other.user_id = ${instance.user_id}
        and (other.routine_instance_id is distinct from ${INSTANCE_ID})
        and to_char(other.date, 'YYYY-MM-DD') in (
          select to_char(date + interval '1 day', 'YYYY-MM-DD')
          from scheduled_workouts where routine_instance_id = ${INSTANCE_ID})`;
    if (clashes.length > 0) throw new Error(`would land on existing sessions: ${JSON.stringify(clashes)} - aborting`);

    console.log(`${sessions.length} scheduled sessions; first ${sessions[0]?.day_key} ${sessions[0]?.name}, last ${sessions.at(-1)?.day_key}`);
    console.log(`instance ${instance.start_key} -> 2026-10-02; every session +1 day`);
    if (!APPLY) {
      console.log("Dry run. Re-run with --apply.");
      return;
    }

    const backupDir = path.join(__dirname, "..", "migration", "program-shift-backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `instance-${INSTANCE_ID}-${Date.now()}.json`);
    const fullSessions = await sql`select * from scheduled_workouts where routine_instance_id = ${INSTANCE_ID}`;
    writeFileSync(backupPath, JSON.stringify({ instance, sessions: fullSessions }, null, 2));
    console.log(`backup: ${backupPath}`);

    await sql.begin(async (tx) => {
      const moved = await tx`
        update scheduled_workouts set date = date + interval '1 day'
        where routine_instance_id = ${INSTANCE_ID} returning id`;
      if (moved.length !== sessions.length) throw new Error(`moved ${moved.length}, expected ${sessions.length}`);
      await tx`
        update routine_instances
        set start_date = start_date + interval '1 day', end_date = end_date + interval '1 day'
        where id = ${INSTANCE_ID}`;
    });

    const [after] = await sql`
      select to_char(start_date, 'YYYY-MM-DD') as s, to_char(end_date, 'YYYY-MM-DD') as e
      from routine_instances where id = ${INSTANCE_ID}`;
    const first = await sql`
      select to_char(date, 'YYYY-MM-DD') as day_key, name from scheduled_workouts
      where routine_instance_id = ${INSTANCE_ID} order by date limit 4`;
    console.log(`after: instance ${after.s} to ${after.e}`);
    console.log(first.map((r) => `${r.day_key} ${r.name}`).join("\n"));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
