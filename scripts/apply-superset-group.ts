/**
 * Add workout_exercises.superset_group.
 *
 * Additive and nullable: every existing row is a solo exercise, which is what
 * null already means, so there is nothing to backfill and no read can break.
 *
 *   npx tsx --env-file=.env.local scripts/apply-superset-group.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql.unsafe(`ALTER TABLE workout_exercises ADD COLUMN IF NOT EXISTS superset_group text;`);
    const cols = await sql`
      select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'workout_exercises'
        and column_name = 'superset_group'`;
    console.log("OK workout_exercises.superset_group:", cols[0] ?? "MISSING");
    if (!cols.length) throw new Error("column missing");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
