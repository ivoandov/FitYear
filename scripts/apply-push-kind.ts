/**
 * Lets `push_subscriptions` hold APNs device tokens beside Web Push endpoints.
 *
 * Web Push does not exist inside a WKWebView, so the iOS app registers an APNs
 * token instead. Both channels live in one table so `sendPushToUser` stays the
 * single fan-out point and the sleeping rest-alert workflow needs no change.
 *
 * ADDITIVE AND NULLABLE ONLY, so it is safe on a live table:
 *   + kind        text not null default 'webpush'   (every existing row keeps its meaning)
 *   + apns_token  text unique                       (null for web rows)
 *   ~ endpoint / p256dh / auth  ->  DROP NOT NULL   (null for APNs rows)
 *
 * Dropping NOT NULL cannot fail on existing data and cannot lose any: it only
 * widens what is allowed. Nothing is deleted, nothing is rewritten.
 *
 * House pattern: dry-run by default, `--apply` to write, one transaction,
 * self-verifying, idempotent (a second run reports nothing to do).
 */
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");

interface Step {
  what: string;
  needed: (state: State) => boolean;
  sql: string;
}

interface State {
  columns: Set<string>;
  notNull: Set<string>;
  hasApnsUnique: boolean;
}

const STEPS: Step[] = [
  {
    what: "add push_subscriptions.kind (not null, default 'webpush')",
    needed: (s) => !s.columns.has("kind"),
    sql: `alter table push_subscriptions add column kind text not null default 'webpush'`,
  },
  {
    what: "add push_subscriptions.apns_token",
    needed: (s) => !s.columns.has("apns_token"),
    sql: `alter table push_subscriptions add column apns_token text`,
  },
  {
    what: "unique index on apns_token (so a re-registering device updates in place)",
    needed: (s) => !s.hasApnsUnique,
    sql: `create unique index if not exists push_subscriptions_apns_token_key on push_subscriptions (apns_token)`,
  },
  {
    what: "endpoint drop not null (an APNs row has a token, not a URL)",
    needed: (s) => s.notNull.has("endpoint"),
    sql: `alter table push_subscriptions alter column endpoint drop not null`,
  },
  {
    what: "p256dh drop not null",
    needed: (s) => s.notNull.has("p256dh"),
    sql: `alter table push_subscriptions alter column p256dh drop not null`,
  },
  {
    what: "auth drop not null",
    needed: (s) => s.notNull.has("auth"),
    sql: `alter table push_subscriptions alter column auth drop not null`,
  },
];

async function readState(sql: postgres.Sql): Promise<State> {
  const cols = (await sql`
    select column_name, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = 'push_subscriptions'`) as unknown as Array<{
    column_name: string;
    is_nullable: string;
  }>;
  const idx = (await sql`
    select indexname from pg_indexes
     where schemaname = 'public' and tablename = 'push_subscriptions'`) as unknown as Array<{
    indexname: string;
  }>;
  return {
    columns: new Set(cols.map((c) => c.column_name)),
    notNull: new Set(cols.filter((c) => c.is_nullable === "NO").map((c) => c.column_name)),
    hasApnsUnique: idx.some((i) => i.indexname.includes("apns_token")),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false });

  try {
    const [{ n: before }] = (await sql`
      select count(*)::int as n from push_subscriptions`) as unknown as Array<{ n: number }>;
    console.log(`push_subscriptions currently holds ${before} row(s)\n`);

    const state = await readState(sql);
    const todo = STEPS.filter((s) => s.needed(state));

    for (const s of STEPS) {
      console.log(`  ${s.needed(state) ? "TODO" : "done"}  ${s.what}`);
    }

    if (todo.length === 0) {
      console.log("\nNothing to do.");
      return;
    }
    if (!APPLY) {
      console.log("\nDRY RUN. Re-run with --apply to write.");
      return;
    }

    await sql.begin(async (tx) => {
      for (const s of todo) await tx.unsafe(s.sql);
    });

    // --- Verify ---
    const after = await readState(sql);
    const [{ n: rows }] = (await sql`
      select count(*)::int as n from push_subscriptions`) as unknown as Array<{ n: number }>;
    const [{ n: webRows }] = (await sql`
      select count(*)::int as n from push_subscriptions where kind = 'webpush'`) as unknown as Array<{
      n: number;
    }>;
    const remaining = STEPS.filter((s) => s.needed(after));

    console.log(`\n--- Verify ---`);
    console.log(`steps still outstanding: ${remaining.length} (want 0)`);
    console.log(`rows before: ${before}, after: ${rows} (must be equal - this migration deletes nothing)`);
    console.log(`rows now marked 'webpush': ${webRows} (every pre-existing row keeps its meaning)`);
    if (remaining.length || rows !== before || webRows !== rows) {
      throw new Error("VERIFY FAILED");
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
