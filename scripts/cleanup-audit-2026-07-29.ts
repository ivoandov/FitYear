/**
 * One-shot cleanup of the data anomalies the 2026-07-29 audit found in prod.
 * The code paths that produced each one are fixed separately; this repairs the
 * rows already written.
 *
 *  1. An ACTIVE routine_instance whose routine was deleted (routine_id has no
 *     FK, so the routine's cascade never reached it). Marked cancelled, and its
 *     not-yet-due scheduled workouts dropped - the same wind-down the DELETE
 *     route now performs.
 *  2. routine_instances.completed_workouts drifting from the real count. The
 *     counter only ever went up, so a deleted session left it overstating
 *     progress. Recomputed from completed_workouts.
 *  3. completed_workouts where started_at is AFTER completed_at, from date
 *     edits that moved only completed_at. started_at is shifted to preserve the
 *     recorded duration, and duration_seconds is recomputed.
 *  4. Rows with a NULL user_id in scheduled_workouts / workout_templates. Every
 *     route filters by user_id, so these are unreachable in the app AND immune
 *     to the auth.users delete cascade. Deleted.
 *
 * NOT touched: the single workout_exercises row with exercise_id = '' (a legacy
 * "Hamstring Curls " with no catalog row anywhere - it stays snapshot-only by
 * design, and the analytics routes now exclude empty ids so it can no longer
 * merge with anything).
 *
 * House pattern: dry-run by default, --apply to write, gitignored backup, one
 * transaction, self-verifying, idempotent.
 *
 *   npx tsx --env-file=.env.local scripts/cleanup-audit-2026-07-29.ts
 *   npx tsx --env-file=.env.local scripts/cleanup-audit-2026-07-29.ts --apply
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = join(process.cwd(), "migration", "audit-cleanup-backups");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    // ACTIVE only: a cancelled instance whose routine is gone is the resolved
    // state this script produces, not a problem to re-report on every run.
    const orphanInstances = await sql`
      select ri.* from routine_instances ri
      where ri.status = 'active'
        and not exists (select 1 from routines r where r.id = ri.routine_id)`;
    const counterDrift = await sql`
      select ri.id, ri.completed_workouts as declared,
        (select count(*)::int from completed_workouts c where c.routine_instance_id = ri.id) as actual
      from routine_instances ri
      where ri.completed_workouts is distinct from
        (select count(*)::int from completed_workouts c where c.routine_instance_id = ri.id)`;
    const skewed = await sql`
      select id, name, started_at, completed_at, duration_seconds
      from completed_workouts where started_at > completed_at`;
    const nullSched = await sql`select * from scheduled_workouts where user_id is null`;
    const nullTemplates = await sql`select * from workout_templates where user_id is null`;

    console.log(`${APPLY ? "APPLY" : "DRY RUN"}`);
    console.log(`  orphaned routine instances : ${orphanInstances.length}`);
    console.log(`  drifting progress counters : ${counterDrift.length}`);
    console.log(`  started_at > completed_at  : ${skewed.length}`);
    console.log(`  null-user scheduled rows   : ${nullSched.length}`);
    console.log(`  null-user template rows    : ${nullTemplates.length}`);

    const total =
      orphanInstances.length +
      counterDrift.length +
      skewed.length +
      nullSched.length +
      nullTemplates.length;
    if (total === 0) {
      console.log("Nothing to do (healthy state).");
      return;
    }
    if (!APPLY) {
      console.log("\nRe-run with --apply to write.");
      return;
    }

    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = join(BACKUP_DIR, `${stamp}.json`);
    writeFileSync(
      backup,
      JSON.stringify(
        { orphanInstances, counterDrift, skewed, nullSched, nullTemplates },
        null,
        2,
      ),
    );
    console.log(`Backup written: ${backup}`);

    await sql.begin(async (tx) => {
      // 1. Wind down instances whose routine is gone.
      for (const inst of orphanInstances) {
        await tx`
          delete from scheduled_workouts
          where routine_instance_id = ${inst.id as string}
            and date >= date_trunc('day', now())`;
        await tx`
          update routine_instances set status = 'cancelled'
          where id = ${inst.id as string} and status = 'active'`;
      }

      // 2. Recompute the hand-maintained progress counters.
      await tx`
        update routine_instances ri
        set completed_workouts = (
          select count(*)::int from completed_workouts c
          where c.routine_instance_id = ri.id
        )
        where ri.completed_workouts is distinct from (
          select count(*)::int from completed_workouts c
          where c.routine_instance_id = ri.id
        )`;

      // 3. Shift started_at back by the recorded duration (or to completed_at
      //    when no usable duration exists), then recompute duration_seconds.
      await tx`
        update completed_workouts
        set started_at = completed_at - (coalesce(nullif(duration_seconds, 0), 0) * interval '1 second'),
            duration_seconds = coalesce(nullif(duration_seconds, 0), 0)
        where started_at > completed_at`;

      // 4. Unreachable rows with no owner.
      await tx`delete from scheduled_workouts where user_id is null`;
      await tx`delete from workout_templates where user_id is null`;
    });

    const [{ n: stillOrphan }] = await sql<{ n: number }[]>`
      select count(*)::int as n from routine_instances ri
      where ri.status = 'active'
        and not exists (select 1 from routines r where r.id = ri.routine_id)`;
    const [{ n: stillDrift }] = await sql<{ n: number }[]>`
      select count(*)::int as n from routine_instances ri
      where ri.completed_workouts is distinct from
        (select count(*)::int from completed_workouts c where c.routine_instance_id = ri.id)`;
    const [{ n: stillSkewed }] = await sql<{ n: number }[]>`
      select count(*)::int as n from completed_workouts where started_at > completed_at`;
    const [{ n: stillNull }] = await sql<{ n: number }[]>`
      select ((select count(*) from scheduled_workouts where user_id is null)
            + (select count(*) from workout_templates where user_id is null))::int as n`;

    const ok =
      stillOrphan === 0 && stillDrift === 0 && stillSkewed === 0 && stillNull === 0;
    console.log(
      ok
        ? "VERIFY OK - 0 active orphans, 0 drifting counters, 0 skewed timestamps, 0 ownerless rows"
        : `VERIFY FAILED - orphans:${stillOrphan} drift:${stillDrift} skew:${stillSkewed} null:${stillNull}`,
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
