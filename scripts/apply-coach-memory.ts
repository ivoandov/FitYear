/**
 * Add FitBot's memory: `coach_notes` (durable facts about a person that their
 * workout rows cannot express) and `coach_conversations` (the running chat
 * transcript, one row per user, so a conversation survives a page refresh).
 *
 * Additive + idempotent (IF NOT EXISTS), never touches existing data.
 *
 * RLS is turned on INLINE here rather than left to `scripts/enable-rls.ts`.
 * That script enumerates pg_tables at RUN TIME, so it only ever covers tables
 * that existed when it last ran - which is exactly how the push tables sat with
 * RLS off and full anon CRUD through the Data API for three weeks. The app is
 * unaffected either way (it connects as `postgres`, which bypasses RLS), and
 * that is precisely what makes the gap silent. No policies is the intended
 * posture: deny everything through PostgREST.
 *
 * These two tables carry the most personal text in the product - what someone
 * is training for, what is injured, everything they have ever said to the
 * coach - so this is the last table in the app that should be readable by anon.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/apply-coach-memory.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS coach_notes (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        kind text NOT NULL,
        content text NOT NULL,
        expires_on timestamp,
        source text NOT NULL DEFAULT 'fitbot',
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS coach_notes_user_id_idx ON coach_notes (user_id);`,
    );

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS coach_conversations (
        user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        messages jsonb NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await sql.unsafe(`ALTER TABLE coach_notes ENABLE ROW LEVEL SECURITY;`);
    await sql.unsafe(`ALTER TABLE coach_conversations ENABLE ROW LEVEL SECURITY;`);

    // Self-verifying: a run that reports anything but both tables present with
    // RLS on has not done its job, and saying "OK" regardless is how a silent
    // half-migration survives.
    const rows = await sql`
      select c.relname as table_name, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('coach_notes', 'coach_conversations')
      order by c.relname`;

    if (rows.length !== 2 || rows.some((r) => !r.rls)) {
      throw new Error(
        `Expected 2 tables with RLS on, got: ${JSON.stringify(rows)}`,
      );
    }
    console.log("OK -", rows.map((r) => `${r.table_name} (RLS on)`).join(", "));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
