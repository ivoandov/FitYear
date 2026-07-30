/**
 * Reports how the live schema differs from `src/lib/db/schema.ts` WITHOUT
 * touching it.
 *
 * `db:push` / `db:migrate` used to sit in package.json pointing drizzle-kit's
 * destructive live diff straight at DATABASE_URL - which is PRODUCTION, shared
 * by dev, unit tests and e2e. One reflexive `npm run db:push` after a schema
 * edit would have issued DDL (drops included) against a database holding real
 * workout history, and there is no `drizzle/` directory or migrations journal
 * to fall back on. Those scripts are gone; DDL goes through an idempotent
 * `scripts/apply-*.ts` reviewed by a human.
 *
 * This is the safe replacement: read-only drift detection.
 *
 *   npx tsx --env-file=.env.local scripts/guard-prod-db.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const tables = await sql<{ table_name: string; columns: number }[]>`
      select t.table_name, count(c.column_name)::int as columns
      from information_schema.tables t
      join information_schema.columns c
        on c.table_schema = t.table_schema and c.table_name = t.table_name
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      group by t.table_name
      order by t.table_name`;

    const rlsOff = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`;

    console.log(`Live schema: ${tables.length} tables`);
    for (const t of tables) {
      console.log(`  ${t.table_name.padEnd(28)} ${t.columns} cols`);
    }

    // Every public table must have RLS on: the app connects as `postgres`
    // (BYPASSRLS), so RLS with no policies is what denies the public Data API.
    // The push tables shipped without it and were world-readable until
    // 2026-07-29 - this makes the next such gap loud.
    if (rlsOff.length > 0) {
      console.error(
        `\nRLS IS OFF on: ${rlsOff.map((r) => r.relname).join(", ")}` +
          `\nRun: npx tsx --env-file=.env.local scripts/enable-rls.ts`,
      );
      process.exitCode = 1;
    } else {
      console.log("\nRLS: on for every public table");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
