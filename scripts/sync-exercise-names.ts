/**
 * Finishes the naming backfill by reaching the two places the rename pass
 * could not.
 *
 * 1. NAME SNAPSHOTS that disagree with the catalog. apply-exercise-renames
 *    only rewrote snapshots for exercises IT renamed, so rows whose name was
 *    already canonical kept whatever an older migration left - 36 of them,
 *    mostly trailing-space names ("Lateral Raises " on 22 rows) plus leftovers
 *    from the 2026-07-17 dedupe ("Cable Face Pull" -> "Face Pulls"). Ivo asked
 *    for snapshots to match the catalog, so they are synced.
 *
 * 2. DOUBLE-ENCODED inline blobs. 62 rows store `exercises` as a jsonb STRING
 *    containing a JSON array rather than a real array - the same legacy wart
 *    the 2026-07-14 pass fixed for muscle_groups_snapshot. jsonb_array_elements
 *    throws on them, so the rename's inline rewrite silently SKIPPED every one,
 *    leaving 7 stale names in workout_templates. They are decoded to real
 *    arrays (which is what the write path has produced since the Phase 4d
 *    cutover) and their names refreshed.
 *
 * Dry-run by default, `--apply` to write. Backup, one transaction, verifies,
 * idempotent.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = path.join(process.cwd(), "migration", "exercise-rename-backups");
const INLINE_TABLES = ["routine_entries", "scheduled_workouts", "workout_templates"] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false });

  try {
    const catalog = new Map<string, string>();
    for (const e of (await sql`select id, name from exercises`) as unknown as Array<{
      id: string;
      name: string;
    }>) {
      catalog.set(e.id, e.name);
    }

    const staleSnapshots = (await sql`
      select we.id, we.name_snapshot, e.name as catalog_name
        from workout_exercises we join exercises e on e.id = we.exercise_id
       where we.name_snapshot is distinct from e.name`) as unknown as Array<{
      id: string;
      name_snapshot: string;
      catalog_name: string;
    }>;

    interface InlineFix {
      table: string;
      id: string;
      next: Record<string, unknown>[];
      wasString: boolean;
      renamed: number;
    }
    const inlineFixes: InlineFix[] = [];

    for (const table of INLINE_TABLES) {
      const rows = (await sql.unsafe(
        `select id, exercises from ${table}`,
      )) as unknown as Array<{ id: string; exercises: unknown }>;
      for (const row of rows) {
        let arr: unknown = row.exercises;
        let wasString = false;
        if (typeof arr === "string") {
          try {
            arr = JSON.parse(arr);
            wasString = true;
          } catch {
            continue; // unparseable; leave it exactly as found
          }
        }
        if (!Array.isArray(arr)) continue;

        let renamed = 0;
        const next = (arr as unknown[]).map((raw) => {
          if (!raw || typeof raw !== "object") return raw;
          const ex = raw as Record<string, unknown>;
          const current = typeof ex.id === "string" ? catalog.get(ex.id) : undefined;
          if (current && ex.name !== current) {
            renamed++;
            return { ...ex, name: current };
          }
          return raw as Record<string, unknown>;
        }) as Record<string, unknown>[];
        if (wasString || renamed) inlineFixes.push({ table, id: row.id, next, wasString, renamed });
      }
    }

    const decodes = inlineFixes.filter((f) => f.wasString).length;
    const renames = inlineFixes.reduce((n, f) => n + f.renamed, 0);
    console.log(`snapshots to sync: ${staleSnapshots.length}`);
    console.log(`inline rows to fix: ${inlineFixes.length} (${decodes} double-encoded, ${renames} stale names)`);

    if (!staleSnapshots.length && !inlineFixes.length) {
      console.log("\nNothing to do.");
      return;
    }
    if (!APPLY) {
      for (const s of staleSnapshots.slice(0, 8)) {
        console.log(`  snapshot ${JSON.stringify(s.name_snapshot)} -> ${JSON.stringify(s.catalog_name)}`);
      }
      console.log("\nDRY RUN. Re-run with --apply to write.");
      return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const at = new Date().toISOString();
    const backupPath = path.join(BACKUP_DIR, `sync-${at.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(
      backupPath,
      JSON.stringify(
        {
          at,
          staleSnapshots,
          inlineBefore: await sql`select 'routine_entries' as t, id, exercises from routine_entries
            union all select 'scheduled_workouts', id, exercises from scheduled_workouts
            union all select 'workout_templates', id, exercises from workout_templates`,
        },
        null,
        2,
      ),
    );
    console.log(`\nBackup written: ${backupPath}`);

    await sql.begin(async (tx) => {
      for (const s of staleSnapshots) {
        await tx`update workout_exercises set name_snapshot = ${s.catalog_name} where id = ${s.id}`;
      }
      for (const f of inlineFixes) {
        // sql.json, NOT JSON.stringify. Binding a stringified array to a jsonb
        // column stores a jsonb STRING, which is the exact double-encoding this
        // script exists to remove - the first run decoded all 62 rows and wrote
        // every one straight back as a string. The codebase already documents
        // this trap for the e2e seed helpers; it applies to any jsonb write.
        if (f.table === "routine_entries") {
          await tx`update routine_entries set exercises = ${tx.json(f.next as unknown as Parameters<typeof tx.json>[0])} where id = ${f.id}`;
        } else if (f.table === "scheduled_workouts") {
          await tx`update scheduled_workouts set exercises = ${tx.json(f.next as unknown as Parameters<typeof tx.json>[0])} where id = ${f.id}`;
        } else {
          await tx`update workout_templates set exercises = ${tx.json(f.next as unknown as Parameters<typeof tx.json>[0])} where id = ${f.id}`;
        }
      }
    });
    console.log("Applied.");

    // --- Verify ---
    const [{ n: snapLeft }] = (await sql`
      select count(*)::int as n from workout_exercises we join exercises e on e.id = we.exercise_id
       where we.name_snapshot is distinct from e.name`) as unknown as Array<{ n: number }>;
    let nonArray = 0;
    let staleLeft = 0;
    for (const table of INLINE_TABLES) {
      const [{ n }] = (await sql.unsafe(
        `select count(*)::int as n from ${table} where jsonb_typeof(exercises) is distinct from 'array'`,
      )) as unknown as Array<{ n: number }>;
      nonArray += n;
      const [{ n: s }] = (await sql.unsafe(
        `select count(*)::int as n from ${table} tt, jsonb_array_elements(tt.exercises) x
           join exercises e on e.id = x->>'id'
          where jsonb_typeof(tt.exercises) = 'array' and x->>'name' is distinct from e.name`,
      )) as unknown as Array<{ n: number }>;
      staleLeft += s;
    }
    console.log(`\n--- Verify ---`);
    console.log(`snapshots still disagreeing: ${snapLeft} (want 0)`);
    console.log(`non-array inline blobs left: ${nonArray} (want 0)`);
    console.log(`inline names still stale: ${staleLeft} (want 0)`);
    if (snapLeft || nonArray || staleLeft) throw new Error("VERIFY FAILED - restore from the backup above");
    console.log("VERIFY OK");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
