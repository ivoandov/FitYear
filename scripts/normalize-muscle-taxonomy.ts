/**
 * One-shot, idempotent normalization of the muscle-group taxonomy across
 * exercises.muscle_groups and workout_exercises.muscle_groups_snapshot.
 *
 * Applies lib/muscle-groups.normalizeMuscleGroups to every row: canonicalizes
 * case + known synonyms/junk strings (e.g. "back"->"Back", "cardiovascular
 * system"->"Cardio", "thoracic spine"->"Back"), PRESERVES specifics (Glutes,
 * Brachialis, Rear Delts, ...), de-dupes, and QUARANTINES (drops) any string
 * that doesn't resolve - reported below so nothing vanishes silently.
 *
 * Safety:
 *  - DRY-RUN by default; pass --apply to write.
 *  - Only rewrites rows whose normalized value differs from the stored one.
 *  - Reports every quarantined (unmatched) string + count before writing.
 *  - Backs up each affected (id, before) to a gitignored JSON file first.
 *  - Writes in a transaction; re-normalizes afterward to prove idempotency
 *    (a second pass finds 0 changes).
 *
 *   npx tsx --env-file=.env.local scripts/normalize-muscle-taxonomy.ts           # dry-run
 *   npx tsx --env-file=.env.local scripts/normalize-muscle-taxonomy.ts --apply   # write
 */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeMuscleGroups, unmatchedMuscles } from "../src/lib/muscle-groups";

type Sql = ReturnType<typeof postgres>;

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.filter((x) => typeof x === "string") : [v];
    } catch {
      return [v];
    }
  }
  return [];
}
const sameArr = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

async function scan(sql: Sql, table: string, col: string) {
  const rows = (await sql`select id, ${sql(col)} as val from ${sql(table)}`) as Array<{
    id: string;
    val: unknown;
  }>;
  const changes: Array<{ id: string; before: string[]; after: string[] }> = [];
  const quarantined = new Map<string, number>();
  for (const r of rows) {
    const cur = asArray(r.val);
    for (const u of unmatchedMuscles(cur)) quarantined.set(u, (quarantined.get(u) ?? 0) + 1);
    const norm = normalizeMuscleGroups(cur);
    if (!sameArr(cur, norm)) changes.push({ id: r.id, before: cur, after: norm });
  }
  return { total: rows.length, changes, quarantined };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  const TABLES: Array<[string, string]> = [
    ["exercises", "muscle_groups"],
    ["workout_exercises", "muscle_groups_snapshot"],
  ];

  try {
    const allBackups: Record<string, Array<{ id: string; before: string[] }>> = {};

    for (const [table, col] of TABLES) {
      const { total, changes, quarantined } = await scan(sql, table, col);
      console.log(`\n=== ${table}.${col} ===`);
      console.log(`rows: ${total}, need rewrite: ${changes.length}`);
      if (quarantined.size > 0) {
        console.log("QUARANTINED (unmatched -> dropped):");
        for (const [s, n] of [...quarantined.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`  ${String(n).padStart(4)}  ${JSON.stringify(s)}`);
        }
      } else {
        console.log("quarantined: none (every string resolved)");
      }
      console.log("sample before -> after:");
      for (const c of changes.slice(0, 12)) {
        console.log(`  ${c.id.slice(0, 8)}  ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
      }
      allBackups[`${table}.${col}`] = changes.map((c) => ({ id: c.id, before: c.before }));

      if (apply && changes.length > 0) {
        const dir = join(process.cwd(), "migration", "muscle-taxonomy-backups");
        mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = join(dir, `${stamp}-${table}.json`);
        writeFileSync(backupPath, JSON.stringify(allBackups[`${table}.${col}`], null, 2));
        console.log(`backed up ${changes.length} rows -> ${backupPath}`);

        await sql.begin(async (tx) => {
          for (const c of changes) {
            await tx`update ${tx(table)} set ${tx(col)} = ${JSON.stringify(c.after)}::jsonb where id = ${c.id}`;
          }
        });
        console.log(`updated ${changes.length} rows.`);

        // Idempotency check: a fresh scan must find 0 changes.
        const again = await scan(sql, table, col);
        if (again.changes.length !== 0) {
          throw new Error(`FAILED idempotency on ${table}: ${again.changes.length} rows still differ`);
        }
        console.log(`verified: re-scan finds 0 further changes (idempotent).`);
      }
    }

    if (!apply) {
      console.log("\nDRY-RUN. Re-run with --apply to write.");
    } else {
      console.log("\nOK - taxonomy normalized.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
