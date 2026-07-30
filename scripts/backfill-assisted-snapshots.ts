/**
 * Backfill `workout_exercises.is_assisted` from the exercise catalog.
 *
 * The completion write path never populated the flag (the client did not
 * reliably send it and the server stored `?? null`), so EVERY history row was
 * null or false and not one was true - even though the catalog flags real
 * assisted movements. On an assisted lift the weight column is counter-
 * assistance, so lower is stronger, and every surface reading the snapshot
 * inverted it: All-time records reported the heaviest assist (the easiest set)
 * as the best, computed an est-1RM from it, and the strength trend's
 * `coalesce(is_assisted,false) = false` filter excluded nothing.
 *
 * The code fix makes new saves correct and the read paths now prefer the
 * catalog, so this only realigns stored history with the catalog it is joined
 * against. LOSSLESS: it copies `exercises.is_assisted` onto rows linked by
 * `exercise_id`, and changes no weights, reps, or set counts.
 *
 * House pattern: dry-run by default, --apply to write, gitignored backup,
 * single transaction, self-verifying, idempotent (a second run reports 0).
 *
 *   npx tsx --env-file=.env.local scripts/backfill-assisted-snapshots.ts
 *   npx tsx --env-file=.env.local scripts/backfill-assisted-snapshots.ts --apply
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = join(process.cwd(), "migration", "assisted-backfill-backups");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    // Rows whose stored flag disagrees with the catalog row they point at.
    const drift = await sql<
      {
        id: string;
        name_snapshot: string | null;
        stored: boolean | null;
        catalog: boolean | null;
      }[]
    >`
      select we.id, we.name_snapshot, we.is_assisted as stored, e.is_assisted as catalog
      from workout_exercises we
      join exercises e on e.id = we.exercise_id
      where we.exercise_id <> ''
        and coalesce(we.is_assisted, false) is distinct from coalesce(e.is_assisted, false)
      order by we.id`;

    const byName = new Map<string, number>();
    for (const r of drift) {
      const k = `${(r.name_snapshot ?? "(unnamed)").trim()} -> ${r.catalog ? "assisted" : "not assisted"}`;
      byName.set(k, (byName.get(k) ?? 0) + 1);
    }

    console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${drift.length} snapshot rows disagree with the catalog`);
    for (const [k, n] of [...byName].sort()) console.log(`  ${n.toString().padStart(4)}  ${k}`);

    if (drift.length === 0) {
      console.log("Nothing to do (healthy state).");
      return;
    }
    if (!APPLY) {
      console.log("\nRe-run with --apply to write.");
      return;
    }

    mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = join(BACKUP_DIR, `${stamp}.json`);
    writeFileSync(backup, JSON.stringify(drift, null, 2));
    console.log(`Backup written: ${backup}`);

    const updated = await sql.begin(async (tx) => {
      const rows = await tx`
        update workout_exercises we
        set is_assisted = coalesce(e.is_assisted, false)
        from exercises e
        where e.id = we.exercise_id
          and we.exercise_id <> ''
          and coalesce(we.is_assisted, false) is distinct from coalesce(e.is_assisted, false)
        returning we.id`;
      return rows.length;
    });
    console.log(`Updated ${updated} rows`);

    // Self-verify: no drift left, and the assisted rows now match the catalog.
    const [{ n: remaining }] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from workout_exercises we
      join exercises e on e.id = we.exercise_id
      where we.exercise_id <> ''
        and coalesce(we.is_assisted, false) is distinct from coalesce(e.is_assisted, false)`;
    const [{ n: nowAssisted }] = await sql<{ n: number }[]>`
      select count(*)::int as n from workout_exercises where is_assisted = true`;
    console.log(
      remaining === 0
        ? `VERIFY OK - 0 rows drifting, ${nowAssisted} snapshots now flagged assisted`
        : `VERIFY FAILED - ${remaining} rows still drifting`,
    );
    if (remaining !== 0) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
