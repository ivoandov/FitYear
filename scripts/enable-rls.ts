/**
 * Security fix (2026-07-07): enable Row-Level Security on every public table.
 *
 * The Supabase Data API (PostgREST at <ref>.supabase.co/rest/v1) was exposing
 * ALL tables via the public anon key (RLS was off) — anyone with the
 * browser-embedded publishable key could read/write every user's rows. The app
 * NEVER uses the Data API (server-side Drizzle only, connecting as the
 * `postgres` role which has BYPASSRLS and owns the tables), so enabling RLS with
 * NO policies denies anon/authenticated PostgREST access while leaving the app
 * fully functional. Idempotent (ENABLE RLS on an already-enabled table is a
 * no-op).
 *
 *   npx tsx --env-file=.env.local scripts/enable-rls.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public' order by tablename`;
    for (const { tablename } of tables) {
      await sql.unsafe(`ALTER TABLE public."${tablename}" ENABLE ROW LEVEL SECURITY`);
    }
    // Report RLS status + confirm the app (this connection) can still read.
    const status = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;
    const off = status.filter((s) => !s.relrowsecurity).map((s) => s.relname);
    console.log(`RLS enabled on ${status.length} tables; still off: ${off.length ? off.join(",") : "(none)"}`);
    const [cw] = await sql<{ n: number }[]>`select count(*)::int n from completed_workouts`;
    const [pr] = await sql<{ n: number }[]>`select count(*)::int n from profiles`;
    console.log(`app read still works (postgres role bypasses RLS): completed_workouts=${cw.n} profiles=${pr.n}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
