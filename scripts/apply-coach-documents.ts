/**
 * Add `coach_documents`: the reports and summaries somebody hands their coach,
 * kept whole so it can be re-read months later (`lib/coach-documents.ts` says
 * why this is not the same thing as a memory note).
 *
 * Additive + idempotent (IF NOT EXISTS), never touches existing data.
 *
 * RLS is turned on INLINE, like the memory tables: `scripts/enable-rls.ts`
 * enumerates pg_tables at RUN TIME and so only ever covers tables that existed
 * when it last ran, which is how the push tables sat with RLS off and full anon
 * CRUD through the Data API for three weeks. This table is the most sensitive
 * one in the product - it can hold somebody's medical records - so no policies
 * and RLS on is the intended posture: deny everything through PostgREST.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/apply-coach-documents.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS coach_documents (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        title text NOT NULL,
        content text NOT NULL,
        source text NOT NULL DEFAULT 'user',
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS coach_documents_user_id_idx ON coach_documents (user_id);`,
    );
    await sql.unsafe(`ALTER TABLE coach_documents ENABLE ROW LEVEL SECURITY;`);

    // Self-verifying: a run that cannot see the table with RLS on has not done
    // its job, and printing OK regardless is how a half-migration survives.
    const rows = await sql`
      select c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'coach_documents'`;

    if (rows.length !== 1 || !rows[0].rls) {
      throw new Error(`Expected coach_documents with RLS on, got: ${JSON.stringify(rows)}`);
    }
    console.log("OK - coach_documents (RLS on)");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
