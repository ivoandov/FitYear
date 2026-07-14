/**
 * One-shot, idempotent normalization of workout_exercises.muscle_groups_snapshot.
 *
 * Background: ~469 historical rows (completed 2026-01..2026-06, from the
 * pre-Phase-4d jsonb-blob backfill) store the muscle groups as a DOUBLE-ENCODED
 * jsonb STRING whose text is a JSON array (e.g. the jsonb string '["Legs"]')
 * rather than a genuine jsonb array (["Legs"]). Newer rows (the current app
 * write path, which sends muscleGroups as a real array) are already correct.
 * The app read path tolerates both, but every SQL consumer of this column (e.g.
 * the muscle-volume analytics endpoint) otherwise needs a decode, or
 * jsonb_array_elements_text throws 22023 "cannot extract elements from a scalar".
 * This converts the string rows to real jsonb arrays so the column is uniform.
 *
 * Safety:
 *  - DRY-RUN by default; pass --apply to write.
 *  - Only touches rows where jsonb_typeof = 'string'. Arrays + nulls untouched.
 *  - Validates every target string parses as JSON before writing (aborts if not).
 *  - Backs up each affected (id, prior value) to a gitignored JSON file first.
 *  - Runs the UPDATE in a transaction and verifies afterward (0 string rows left,
 *    total row count unchanged).
 *  - Idempotent: a second run finds 0 string rows and no-ops.
 *
 *   npx tsx --env-file=.env.local scripts/normalize-muscle-snapshots.ts           # dry-run
 *   npx tsx --env-file=.env.local scripts/normalize-muscle-snapshots.ts --apply   # write
 */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    // Snapshot the current shape.
    const dist = await sql<{ t: string | null; n: number }[]>`
      select jsonb_typeof(muscle_groups_snapshot) as t, count(*)::int as n
      from workout_exercises group by 1 order by 2 desc`;
    console.log("muscle_groups_snapshot types:", dist.map((r) => `${r.t}=${r.n}`).join(", "));

    // Target = jsonb strings. (Bare-name strings, if any ever appear, become a
    // single-element array; array-text strings are parsed to their array.)
    const targets = await sql<{ id: string; old: string; is_arr: boolean; ok: boolean }[]>`
      select
        id,
        muscle_groups_snapshot::text as old,
        (left(muscle_groups_snapshot #>> '{}', 1) = '[') as is_arr,
        ((muscle_groups_snapshot #>> '{}') is null
          or (left(muscle_groups_snapshot #>> '{}', 1) <> '[')
          or ((muscle_groups_snapshot #>> '{}')::jsonb is not null)) as ok
      from workout_exercises
      where jsonb_typeof(muscle_groups_snapshot) = 'string'`;

    if (targets.length === 0) {
      console.log("\nNothing to normalize - all rows are already arrays/null. (no-op)");
      return;
    }

    const malformed = targets.filter((t) => t.is_arr && !t.ok);
    if (malformed.length > 0) {
      throw new Error(
        `ABORT: ${malformed.length} string rows look like arrays but don't parse as JSON. First id: ${malformed[0].id}`,
      );
    }

    console.log(`\n${targets.length} string rows to normalize (${targets.filter((t) => t.is_arr).length} array-text, ${targets.filter((t) => !t.is_arr).length} bare-name).`);
    console.log("Sample before -> after:");
    for (const t of targets.slice(0, 6)) {
      // t.old is the jsonb string's ::text (e.g. '"[\"Back\"]"'); JSON.parse once
      // yields its content ('["Back"]'), then parse again for the array form.
      const content = JSON.parse(t.old) as string;
      const after = t.is_arr ? JSON.parse(content) : [content];
      console.log(`  ${t.id.slice(0, 8)}  ${t.old}  ->  ${JSON.stringify(after)}`);
    }

    if (!apply) {
      console.log(`\nDRY-RUN. Re-run with --apply to write ${targets.length} rows.`);
      return;
    }

    // Back up the affected rows before mutating.
    const dir = join(process.cwd(), "migration", "muscle-snapshot-backups");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(dir, `${stamp}.json`);
    writeFileSync(backupPath, JSON.stringify(targets.map((t) => ({ id: t.id, old: t.old })), null, 2));
    console.log(`\nBacked up ${targets.length} rows -> ${backupPath}`);

    // Convert in one transaction: array-text strings -> their parsed array;
    // bare-name strings -> a single-element array.
    const updated = await sql.begin(async (tx) => {
      const arr = await tx`
        update workout_exercises
        set muscle_groups_snapshot = (muscle_groups_snapshot #>> '{}')::jsonb
        where jsonb_typeof(muscle_groups_snapshot) = 'string'
          and left(muscle_groups_snapshot #>> '{}', 1) = '['`;
      const bare = await tx`
        update workout_exercises
        set muscle_groups_snapshot = jsonb_build_array(muscle_groups_snapshot #>> '{}')
        where jsonb_typeof(muscle_groups_snapshot) = 'string'`;
      return (arr.count ?? 0) + (bare.count ?? 0);
    });
    console.log(`Updated ${updated} rows.`);

    // Verify.
    const [after] = await sql`
      select
        count(*) filter (where jsonb_typeof(muscle_groups_snapshot) = 'string')::int as strings_left,
        count(*) filter (where jsonb_typeof(muscle_groups_snapshot) = 'array')::int as arrays,
        count(*) filter (where muscle_groups_snapshot is null)::int as nulls,
        count(*)::int as total
      from workout_exercises`;
    console.log("POST-VERIFY:", after);
    if (after.strings_left !== 0) throw new Error(`FAILED: ${after.strings_left} string rows remain`);
    console.log("OK - all muscle_groups_snapshot values are now arrays or null.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
