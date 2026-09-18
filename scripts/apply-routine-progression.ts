/**
 * Add `routines.progression`, the routine's default progressive-overload rule.
 *
 * Additive, nullable and idempotent. NO BACKFILL on purpose: null means "this
 * routine does not add weight", which is the honest state for every routine
 * that existed before the feature. Stamping a default onto them would start
 * adding weight to people's programs uninvited, and a prescribed load climbing
 * on its own is exactly the kind of silent change that erodes trust in a plan.
 *
 * The per-exercise override needs no migration: it lives inline on
 * `routine_entries.exercises[].progression`, which is already jsonb.
 *
 *   npx tsx --env-file=.env.local scripts/apply-routine-progression.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5 });

  try {
    await sql.unsafe(`ALTER TABLE routines ADD COLUMN IF NOT EXISTS progression jsonb;`);

    // Self-verifying: a migration that reports success without the column
    // existing is how a half-applied change survives.
    const [col] = await sql`
      select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'routines' and column_name = 'progression'`;
    if (!col) throw new Error("progression column missing after ALTER");

    const [counts] = await sql`
      select count(*)::int as total, count(progression)::int as with_rule from routines`;
    console.log(`OK - routines.progression is ${col.data_type}`);
    console.log(`routines: ${counts.total}, with a rule: ${counts.with_rule} (0 expected on first run)`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
