/**
 * Adds `user_settings.time_zone` so the viewer's device timezone is STORED,
 * not just carried on the request.
 *
 * The app already knew the zone per request (the `fy_tz` cookie stamped by
 * components/TimeZoneCookie), but nothing persisted it. Anything without a
 * request context therefore had to assume a zone - including the read-only
 * integration endpoint another service calls on a schedule, which was
 * defaulting to America/Los_Angeles while Ivo travels.
 *
 * Idempotent and additive. Dry run by default, `--apply` to write.
 *
 * Nullable with NO default and NO backfill: null means "never seen", which
 * readers fall back on. Stamping every existing row with one guessed zone would
 * be worse than admitting we do not know.
 *
 * RLS: `user_settings` is pre-existing and already has row level security on
 * (see scripts/enable-rls.ts), so this adds no new RLS surface.
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false });

  try {
    const [{ exists: hasColumn }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'user_settings'
          and column_name = 'time_zone'
      ) as exists
    `;
    const [{ count: total }] = await sql<{ count: string }[]>`
      select count(*)::text as count from user_settings
    `;

    if (hasColumn) {
      const [{ count: set }] = await sql<{ count: string }[]>`
        select count(*)::text as count from user_settings where time_zone is not null
      `;
      console.log(`time_zone already exists. ${total} settings rows, ${set} with a zone recorded.`);
      console.log("Nothing to do (idempotent re-run = 0 changes).");
      return;
    }

    console.log(`user_settings: ${total} rows`);
    console.log("Planned:");
    console.log("  ALTER TABLE user_settings ADD COLUMN time_zone text;   (nullable, no default, no backfill)");

    if (!APPLY) {
      console.log("\nDRY RUN. Re-run with --apply to write.");
      return;
    }

    await sql`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS time_zone text`;

    const [{ exists: nowHas }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='user_settings' and column_name='time_zone'
      ) as exists
    `;
    const [{ count: stamped }] = await sql<{ count: string }[]>`
      select count(*)::text as count from user_settings where time_zone is not null
    `;

    console.log(`\nVERIFY: column=${nowHas} stamped_existing_rows=${stamped}`);
    if (!nowHas) throw new Error("VERIFY FAILED: column missing");
    if (stamped !== "0") {
      throw new Error(`VERIFY FAILED: ${stamped} existing rows got a zone; all should be NULL`);
    }
    console.log("VERIFY OK");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
