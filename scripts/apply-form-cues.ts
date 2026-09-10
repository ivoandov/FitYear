/**
 * Add exercises.form_cues and exercises.video_id.
 *
 * Additive and nullable, so it needs no backfill and cannot break a read.
 * Neither column is client-writable: the exercise routes omit them the same way
 * they omit imageUrl, because the catalog is SHARED and one crafted value would
 * be everybody's problem rather than one user's.
 *
 *   npx tsx --env-file=.env.local scripts/apply-form-cues.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql.unsafe(`ALTER TABLE exercises ADD COLUMN IF NOT EXISTS form_cues jsonb;`);
    await sql.unsafe(`ALTER TABLE exercises ADD COLUMN IF NOT EXISTS video_id text;`);
    const cols = await sql`
      select column_name, data_type, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'exercises'
        and column_name in ('form_cues', 'video_id')
      order by column_name`;
    console.log("OK exercises:", cols);
    if (cols.length !== 2) throw new Error("expected both columns");
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
