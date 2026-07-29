/**
 * Add the rest-timer push tables: `push_subscriptions` (one row per
 * browser/device Web Push subscription) and `rest_notifications` (one row per
 * scheduled rest alert, so a skipped rest can cancel its pending push).
 * Additive + idempotent (IF NOT EXISTS), never touches existing data. Run with:
 *   npx tsx --env-file=.env.local scripts/apply-push-tables.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        endpoint text NOT NULL UNIQUE,
        p256dh text NOT NULL,
        auth text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx ON push_subscriptions (user_id);`,
    );
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS rest_notifications (
        id varchar PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'pending',
        exercise_name text,
        fire_at timestamp NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS rest_notifications_user_id_idx ON rest_notifications (user_id);`,
    );

    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('push_subscriptions', 'rest_notifications')
      order by table_name`;
    console.log("OK - tables:", tables.map((t) => t.table_name).join(", ") || "MISSING");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
