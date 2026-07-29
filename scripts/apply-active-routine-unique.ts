/**
 * One ACTIVE instance per (user, routine).
 *
 * Starting a routine pre-checks for date conflicts and then writes, with
 * nothing enforcing the invariant in between, so a double-tap on Start had both
 * requests pass the check and double-book every day of the program. A PARTIAL
 * unique index (active rows only) makes the loser fail cleanly; the route turns
 * that into "already started" and returns the winning instance.
 *
 * Partial on purpose: re-running a routine you finished or cancelled is normal,
 * so only `status = 'active'` is constrained. Additive + idempotent, aborts if
 * existing data would violate it. Run with:
 *   npx tsx --env-file=.env.local scripts/apply-active-routine-unique.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const dupes = await sql`
      select user_id, routine_id, count(*) c
      from routine_instances
      where status = 'active'
      group by 1, 2
      having count(*) > 1`;
    if (dupes.length > 0) {
      throw new Error(
        `ABORT: ${dupes.length} (user, routine) pairs already have multiple ACTIVE instances - resolve first: ` +
          JSON.stringify(dupes),
      );
    }

    await sql.unsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS routine_instances_active_unique
      ON routine_instances (user_id, routine_id)
      WHERE status = 'active';
    `);

    const [idx] = await sql`
      select indexname from pg_indexes
      where tablename = 'routine_instances'
        and indexname = 'routine_instances_active_unique'`;
    console.log("OK - index:", idx?.indexname ?? "MISSING");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
