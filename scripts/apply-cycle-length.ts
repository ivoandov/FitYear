/**
 * Add the additive, nullable routines.cycle_length column used to render the
 * true rotating-cycle indicator on the Routines card (FitBot programs). Nullable
 * so existing manual / legacy weekday routines are untouched and keep the M-S
 * strip. Idempotent (ADD COLUMN IF NOT EXISTS), safe to re-run, never touches
 * data. Run with:
 *   npx tsx --env-file=.env.local scripts/apply-cycle-length.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    await sql.unsafe(
      `ALTER TABLE routines ADD COLUMN IF NOT EXISTS cycle_length integer;`,
    );
    const cols = await sql`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'routines'
        and column_name = 'cycle_length'`;
    console.log("OK - routines.cycle_length:", cols[0] ?? "MISSING");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
