/**
 * Add the unique index enforcing one completed_workouts row per
 * (user_id, display_id) - the DB backstop for the save-path idempotency in
 * POST /api/completed-workouts (a double-fired save must not insert twice;
 * see the 2026-07-14 duplicated "Push ups" incident). Additive + idempotent
 * (CREATE UNIQUE INDEX IF NOT EXISTS), never touches data. Prod was verified
 * duplicate-free before this ships. Run with:
 *   npx tsx --env-file=.env.local scripts/apply-workout-display-unique.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const dupes = await sql`
      select user_id, display_id, count(*) c
      from completed_workouts
      group by user_id, display_id
      having count(*) > 1`;
    if (dupes.length > 0) {
      throw new Error(
        `ABORT: ${dupes.length} duplicate (user_id, display_id) groups exist - resolve them first: ` +
          JSON.stringify(dupes),
      );
    }
    await sql.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS completed_workouts_user_display_unique
       ON completed_workouts (user_id, display_id);`,
    );
    const [idx] = await sql`
      select indexname from pg_indexes
      where tablename = 'completed_workouts'
        and indexname = 'completed_workouts_user_display_unique'`;
    console.log("OK - index:", idx?.indexname ?? "MISSING");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
