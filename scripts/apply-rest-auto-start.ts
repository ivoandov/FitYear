/**
 * Add `user_settings.rest_timer_auto_start`: whether the rest timer starts on
 * its own when a set is completed, stored on the ACCOUNT (2026-09-30).
 *
 * It lived only in the browser's localStorage, so it was per device, reset
 * whenever site data was cleared, and did not follow the person between their
 * phone and their computer. Nullable with no default on purpose: null means
 * "never set on the account", which is what lets the client push an existing
 * browser choice up once instead of overwriting it with a default.
 *
 * Additive + idempotent. MUST run before the code that reads it deploys: the
 * settings query selects every column by name, so a missing column fails
 * settings everywhere, not just this switch.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/apply-rest-auto-start.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql.unsafe(
      `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS rest_timer_auto_start boolean;`,
    );
    // Self-verifying: printing OK without checking is how a half-migration hides.
    const rows = await sql`
      select data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'user_settings'
        and column_name = 'rest_timer_auto_start'`;
    if (rows.length !== 1 || rows[0].data_type !== "boolean" || rows[0].is_nullable !== "YES") {
      throw new Error(`Expected a nullable boolean column, got: ${JSON.stringify(rows)}`);
    }
    console.log("OK - user_settings.rest_timer_auto_start (boolean, nullable)");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
