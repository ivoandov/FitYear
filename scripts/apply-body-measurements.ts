/**
 * Create body_measurements.
 *
 * Idempotent and additive. Two things this script must do that are easy to
 * forget, both of which have bitten this project before:
 *
 *  1. ENABLE ROW LEVEL SECURITY inline. `scripts/enable-rls.ts` enumerates
 *     tables at RUN TIME, so it only ever covered what existed when it last
 *     ran - the push tables sat with RLS off and full anon CRUD through the
 *     Data API for three weeks because of exactly this. RLS with no policies is
 *     the intended posture: the app connects as postgres and bypasses it, and
 *     PostgREST is denied everything.
 *  2. A unique index on (user_id, measured_on), so logging your weight twice on
 *     the same day updates the day rather than drawing two points.
 *
 *   npx tsx --env-file=.env.local scripts/apply-body-measurements.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS body_measurements (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        measured_on timestamp NOT NULL,
        weight_lbs real,
        body_fat_pct real,
        circumferences jsonb,
        photo_path text,
        notes text,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS body_measurements_user_id_idx ON body_measurements (user_id);`,
    );
    await sql.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS body_measurements_user_day_unique ON body_measurements (user_id, measured_on);`,
    );
    await sql.unsafe(`ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;`);

    const [{ rls }] = await sql`
      select relrowsecurity as rls from pg_class where relname = 'body_measurements'`;
    const cols = await sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'body_measurements'
      order by ordinal_position`;
    const idx = await sql`
      select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'body_measurements'
      order by indexname`;
    console.log("OK body_measurements");
    console.log("  RLS enabled:", rls);
    console.log("  columns:", cols.map((c) => c.column_name).join(", "));
    console.log("  indexes:", idx.map((i) => i.indexname).join(", "));
    if (!rls) throw new Error("RLS is OFF - do not ship this");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
