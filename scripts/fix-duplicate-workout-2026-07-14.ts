/**
 * One-shot fix: remove the duplicated "Push ups" completed workout from
 * 2026-07-14 (local; stored 2026-07-15 UTC).
 *
 * A double-save race produced two completed_workouts rows with the SAME
 * started_at (2026-07-15T05:21:00.815Z), completed 1.8s apart:
 *   - KEEP   ef2cfa9f-866d-447a-92c9-dff1d9a3aacb  (6 sets: 20/20/15/15/15/15)
 *   - DELETE 6c7cbebf-0106-4d3e-8893-63c2680ba082  (4 sets: 20/20/15/15,
 *     a strict prefix of KEEP's sets - no unique data is lost)
 *
 * House migration pattern: dry-run by default, `--apply` to execute,
 * gitignored JSON backup of every deleted row, single transaction,
 * precondition + post checks, idempotent (re-run reports 0 changes).
 *
 * NOTE: the duplicate row's Google Calendar event
 * (calendar_event_id 290uvjjpg71orbs9d9vbd3jp5c) is NOT deleted here - the
 * Google OAuth client credentials only exist in Vercel env scopes, not
 * locally. Ivo deletes the extra "Push ups" event from Google Calendar by
 * hand (one event, July 14 evening).
 */
import postgres from "postgres";
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

config({ path: path.join(__dirname, "..", ".env.local") });

const KEEP_ID = "ef2cfa9f-866d-447a-92c9-dff1d9a3aacb";
const DELETE_ID = "6c7cbebf-0106-4d3e-8893-63c2680ba082";
const EXPECTED_USER_EMAIL = "thebballkid@gmail.com";
const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const [keep] = await sql`
      select * from completed_workouts where id = ${KEEP_ID}`;
    const [dup] = await sql`
      select * from completed_workouts where id = ${DELETE_ID}`;

    if (!keep) throw new Error(`KEEP workout ${KEEP_ID} not found - aborting`);
    const keepSets = await sql`
      select ws.* from workout_sets ws
      join workout_exercises we on we.id = ws.workout_exercise_id
      where we.completed_workout_id = ${KEEP_ID} order by ws.set_number`;
    if (keepSets.length !== 6)
      throw new Error(`KEEP has ${keepSets.length} sets, expected 6 - aborting`);

    if (!dup) {
      console.log("Duplicate row already gone; KEEP intact with 6 sets. 0 changes (idempotent re-run).");
      return;
    }

    // Preconditions: same user (the expected account), same started_at, and
    // nothing else references the duplicate.
    const [{ email }] = await sql`
      select u.email from auth.users u where u.id = ${dup.user_id}`;
    if (email !== EXPECTED_USER_EMAIL)
      throw new Error(`Duplicate belongs to ${email}, expected ${EXPECTED_USER_EMAIL} - aborting`);
    if (String(dup.started_at?.getTime()) !== String(keep.started_at?.getTime()))
      throw new Error("started_at mismatch between the two rows - not the known duplicate pair, aborting");
    const prRefs = await sql`
      select id from pr_history where workout_id = ${DELETE_ID}`;
    if (prRefs.length > 0)
      throw new Error(`pr_history references the duplicate (${prRefs.length} rows) - aborting`);

    const dupExercises = await sql`
      select * from workout_exercises where completed_workout_id = ${DELETE_ID}`;
    const dupSets = await sql`
      select ws.* from workout_sets ws
      join workout_exercises we on we.id = ws.workout_exercise_id
      where we.completed_workout_id = ${DELETE_ID}`;

    console.log(`Duplicate ${DELETE_ID}: 1 workout row, ${dupExercises.length} exercise rows, ${dupSets.length} set rows.`);
    console.log(`Orphaned calendar event to delete by hand: ${dup.calendar_event_id}`);

    if (!APPLY) {
      console.log("DRY RUN - no changes. Re-run with --apply to execute.");
      return;
    }

    const backupDir = path.join(__dirname, "..", "migration", "duplicate-workout-backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(backupPath, JSON.stringify({ workout: dup, exercises: dupExercises, sets: dupSets }, null, 2));
    console.log(`Backup written: ${backupPath}`);

    await sql.begin(async (tx) => {
      await tx`delete from workout_sets where workout_exercise_id in
        (select id from workout_exercises where completed_workout_id = ${DELETE_ID})`;
      await tx`delete from workout_exercises where completed_workout_id = ${DELETE_ID}`;
      await tx`delete from completed_workouts where id = ${DELETE_ID}`;
    });

    // Post-verify.
    const [gone] = await sql`select id from completed_workouts where id = ${DELETE_ID}`;
    const keepSetsAfter = await sql`
      select ws.id from workout_sets ws
      join workout_exercises we on we.id = ws.workout_exercise_id
      where we.completed_workout_id = ${KEEP_ID}`;
    if (gone) throw new Error("VERIFY FAILED: duplicate still present");
    if (keepSetsAfter.length !== 6) throw new Error("VERIFY FAILED: KEEP no longer has 6 sets");
    console.log("APPLIED + VERIFIED: duplicate deleted, KEEP intact (6 sets, 100 reps).");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
