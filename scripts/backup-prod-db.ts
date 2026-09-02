/**
 * Full logical backup of the production database.
 *
 * Written 2026-09-02 before the account-deletion route and the push-schema
 * migration went in: both are destructive in ways the existing per-migration
 * JSON backups do not cover, and "no user data is lost, make backups if
 * necessary" is a standing instruction from Ivo.
 *
 * WHERE IT WRITES, and why not in the repo: `~/fityear-backups/`. Every other
 * backup in this project (migration/exercise-rename-backups/) is scoped to one
 * migration and gitignored inside the repo. A FULL dump is different: it
 * contains every user's email and training history, so it must not sit inside
 * a git working tree at all, where one `git add -A` could publish it.
 *
 * CONNECTION: `pg_dump` needs a SESSION connection, so this rewrites the
 * runtime `DATABASE_URL` from the transaction pooler (`:6543`, which the app
 * must use - see the gotchas) to session mode (`:5432`) on the same host. The
 * direct `db.<ref>.supabase.co` host is IPv6-only and hangs from this machine,
 * which is why the pooler host is kept.
 *
 * Restores with:  psql "<session url>" -f <the .sql file>
 * Verify a backup without restoring:  --verify <path>
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const BACKUP_DIR = path.join(os.homedir(), "fityear-backups");

/** Tables whose row counts are recorded beside the dump, as a cheap integrity check. */
const COUNTED = [
  "completed_workouts",
  "workout_exercises",
  "workout_sets",
  "exercises",
  "routines",
  "routine_entries",
  "routine_instances",
  "scheduled_workouts",
  "workout_templates",
  "user_settings",
  "google_calendar_tokens",
  "pr_history",
  "exercise_goals",
  "push_subscriptions",
  "rest_notifications",
  "active_workouts",
  "profiles",
  "ai_usage",
] as const;

function sessionUrl(runtimeUrl: string): string {
  // Transaction pooler -> session pooler. Same host, same credentials.
  return runtimeUrl.replace(":6543/", ":5432/");
}

async function counts(url: string): Promise<Record<string, number>> {
  const sql = postgres(url, { prepare: false });
  try {
    const out: Record<string, number> = {};
    for (const t of COUNTED) {
      const r = (await sql.unsafe(`select count(*)::int as n from ${t}`)) as unknown as Array<{
        n: number;
      }>;
      out[t] = r[0].n;
    }
    const u = (await sql`select count(*)::int as n from auth.users`) as unknown as Array<{
      n: number;
    }>;
    out["auth.users"] = u[0].n;
    return out;
  } finally {
    await sql.end();
  }
}

/** A dump is only trustworthy if it contains the COPY blocks it should. */
function verify(file: string, expected: Record<string, number> | null): boolean {
  const text = fs.readFileSync(file, "utf8");
  const bytes = fs.statSync(file).size;
  console.log(`\n--- Verify ${path.basename(file)} (${(bytes / 1024 / 1024).toFixed(1)} MB) ---`);

  let ok = true;
  if (!text.includes("PostgreSQL database dump complete")) {
    console.log("MISSING the completion marker - the dump was TRUNCATED");
    ok = false;
  }
  // Counted line by line rather than with a regex. An EMPTY table emits its
  // terminator on the very next line, and a lazy regex then ran past it and
  // counted the following table's rows - which reported 52 push subscriptions
  // against a table holding none.
  const lines = text.split("\n");
  const rowsByTable = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^COPY (?:public|auth)\.(\w+) \(.*\) FROM stdin;$/);
    if (!m) continue;
    let n = 0;
    for (let j = i + 1; j < lines.length && lines[j] !== "\\."; j++) n++;
    rowsByTable.set(m[1], n);
  }

  for (const t of COUNTED) {
    const rows = rowsByTable.has(t) ? rowsByTable.get(t)! : -1;
    const want = expected?.[t];
    const flag = rows < 0 ? "NO COPY BLOCK" : want !== undefined && rows !== want ? `MISMATCH (db has ${want})` : "";
    if (flag) ok = false;
    console.log(`  ${t.padEnd(24)} ${String(rows).padStart(6)} ${flag}`);
  }
  return ok;
}

async function main() {
  const runtime = process.env.DATABASE_URL;
  if (!runtime) throw new Error("DATABASE_URL is not set");

  const verifyOnly = process.argv.indexOf("--verify");
  if (verifyOnly !== -1) {
    const file = process.argv[verifyOnly + 1];
    if (!file) throw new Error("--verify needs a file path");
    process.exit(verify(file, await counts(sessionUrl(runtime))) ? 0 : 1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = path.join(BACKUP_DIR, `fityear-${stamp}.sql`);

  const before = await counts(sessionUrl(runtime));
  console.log("Live row counts:");
  for (const [t, n] of Object.entries(before)) console.log(`  ${t.padEnd(24)} ${n}`);

  console.log(`\nDumping to ${file} ...`);
  const url = sessionUrl(runtime);
  const dump = (args: string[]) =>
    execFileSync("pg_dump", [url, "--no-owner", "--no-acl", ...args], {
      maxBuffer: 1024 * 1024 * 512,
      encoding: "buffer",
    });

  // TWO dumps, not one. `--schema=public --table=auth.users` intersects to
  // nothing and silently produces DDL with no rows - the first version of this
  // script did exactly that and only the verify step below caught it.
  //
  // Order matters on restore: every public table has a foreign key to
  // auth.users, and pg_dump adds constraints AFTER loading data, so the
  // identity rows have to be in place first.
  const authData = dump(["--data-only", "--table=auth.users", "--table=auth.identities"]);
  const publicAll = dump(["--schema=public"]);

  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from(
        "-- FitYear full backup. auth identity rows first, then the public schema,\n" +
          "-- because public tables carry foreign keys to auth.users.\n" +
          "-- Restore: psql \"<session pooler url, port 5432>\" -f this-file\n\n",
      ),
      authData,
      Buffer.from("\n\n"),
      publicAll,
    ]),
    { mode: 0o600 },
  );

  const ok = verify(file, before);
  fs.writeFileSync(
    file.replace(/\.sql$/, ".counts.json"),
    JSON.stringify({ at: new Date().toISOString(), file: path.basename(file), counts: before }, null, 2),
    { mode: 0o600 },
  );

  console.log(ok ? "\nBACKUP OK" : "\nBACKUP FAILED VERIFICATION");
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
