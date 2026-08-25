/**
 * Adds `exercises.created_at` so the pickers can surface a freshly created
 * exercise at the top instead of burying it in a 117-item alphabetical list.
 *
 * Idempotent and additive. Run with no flag for a dry run, `--apply` to write.
 *
 * DELIBERATELY TWO STATEMENTS, and the order matters:
 *   ADD COLUMN ... DEFAULT now()  would backfill EVERY existing row with the
 *   same timestamp, marking the whole catalog "recently added" - the exact
 *   opposite of the point. So the column is added with NO default (existing
 *   rows stay NULL = "not recent"), and the default is set afterwards so only
 *   rows inserted from here on get a timestamp.
 *
 * RLS: `exercises` is a pre-existing table that already has row level security
 * enabled (see scripts/enable-rls.ts and the gotcha about tables created
 * later), so this adds no new RLS surface.
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
          and table_name = 'exercises'
          and column_name = 'created_at'
      ) as exists
    `;

    const [{ count: total }] = await sql<{ count: string }[]>`
      select count(*)::text as count from exercises
    `;

    if (hasColumn) {
      const [{ count: nulls }] = await sql<{ count: string }[]>`
        select count(*)::text as count from exercises where created_at is null
      `;
      console.log(`created_at already exists. ${total} exercises, ${nulls} with NULL created_at.`);
      console.log("Nothing to do (idempotent re-run = 0 changes).");
      return;
    }

    console.log(`exercises: ${total} rows`);
    console.log("Planned:");
    console.log("  ALTER TABLE exercises ADD COLUMN created_at timestamp;   (no default: existing rows stay NULL)");
    console.log("  ALTER TABLE exercises ALTER COLUMN created_at SET DEFAULT now();  (new rows only)");

    if (!APPLY) {
      console.log("\nDRY RUN. Re-run with --apply to write.");
      return;
    }

    await sql.begin(async (tx) => {
      await tx`ALTER TABLE exercises ADD COLUMN IF NOT EXISTS created_at timestamp`;
      await tx`ALTER TABLE exercises ALTER COLUMN created_at SET DEFAULT now()`;
    });

    // Self-verify: column present, default set, and NO existing row was stamped.
    const [{ exists: nowHas }] = await sql<{ exists: boolean }[]>`
      select exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='exercises' and column_name='created_at'
      ) as exists
    `;
    const [{ column_default }] = await sql<{ column_default: string | null }[]>`
      select column_default from information_schema.columns
      where table_schema='public' and table_name='exercises' and column_name='created_at'
    `;
    const [{ count: stamped }] = await sql<{ count: string }[]>`
      select count(*)::text as count from exercises where created_at is not null
    `;

    console.log(`\nVERIFY: column=${nowHas} default=${column_default ?? "(none)"} stamped_existing_rows=${stamped}`);
    if (!nowHas || !column_default) throw new Error("VERIFY FAILED: column or default missing");
    if (stamped !== "0") {
      throw new Error(
        `VERIFY FAILED: ${stamped} pre-existing rows got a timestamp; they should all be NULL`,
      );
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
