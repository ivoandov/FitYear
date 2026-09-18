/**
 * Fold ONE catalog exercise into another. Dry-run by default.
 *
 *   npx tsx --env-file=.env.local scripts/merge-exercise-pair.ts --keep <id> --absorb <id>
 *   npx tsx --env-file=.env.local scripts/merge-exercise-pair.ts --keep <id> --absorb <id> --apply
 *
 * Why not `merge-duplicate-exercises.ts`: its July config renames every
 * survivor to its July name, and the 2026-08-27 naming pass has renamed those
 * rows since, so its sanity check now refuses to run - correctly, since a
 * re-run would roll the names back. This does one pair and nothing else.
 *
 * First used 2026-09-18: Ivo folded "Split Squats" into "Bulgarian Split
 * Squats" ("bulgarian"), reversing the July keep-separate call, because the
 * split squat he trains is the rear-foot-elevated one.
 *
 * Does, in one transaction: repoints workout history, pr_history and
 * exercise_goals; rewrites inline references (templates, scheduled workouts,
 * routine entries, the active workout) by id AND by normalized name, since
 * FitBot and import entries are name-only; deletes the absorbed row. History
 * NAME SNAPSHOTS are left alone on purpose - they record what the exercise was
 * called when it was done. Backs up every touched row first, verifies after,
 * and a re-run once the absorbed row is gone is a no-op.
 */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeExerciseName } from "../src/lib/exercise-match";

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const KEEP = arg("--keep");
const ABSORB = arg("--absorb");
const APPLY = process.argv.includes("--apply");

type Entry = Record<string, unknown>;

async function main() {
  if (!KEEP || !ABSORB || KEEP === ABSORB) throw new Error("need distinct --keep and --absorb ids");
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const [keep] = await sql<{ id: string; name: string }[]>`select id, name from exercises where id = ${KEEP}`;
    const [absorb] = await sql<{ id: string; name: string }[]>`select id, name from exercises where id = ${ABSORB}`;
    if (!keep) throw new Error(`survivor ${KEEP} not found`);
    if (!absorb) {
      console.log(`absorbed row ${ABSORB} is already gone - nothing to do`);
      return;
    }
    console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}\nKEEP   ${keep.id} "${keep.name}"\nABSORB ${absorb.id} "${absorb.name}"`);

    const absorbName = normalizeExerciseName(absorb.name);
    const rewrite = (entries: Entry[]): boolean => {
      let changed = false;
      for (const e of entries) {
        const byId = e.id === absorb.id;
        const byName = typeof e.name === "string" && normalizeExerciseName(e.name) === absorbName;
        if (!byId && !byName) continue;
        if (e.id !== undefined) e.id = keep.id;
        e.name = keep.name;
        changed = true;
      }
      return changed;
    };

    // Inline jsonb references, found by id or by name.
    const fixes: Array<{ table: string; id: string; col: string; before: unknown; next: unknown }> = [];
    const scan = async (table: string, col: string, wrap?: string) => {
      const rows = (await sql`select id, ${sql(col)} as val from ${sql(table)}`) as Array<{ id: string; val: unknown }>;
      for (const r of rows) {
        const container = wrap ? (r.val as Record<string, unknown> | null) : null;
        const arr = wrap ? container?.[wrap] : r.val;
        if (!Array.isArray(arr)) continue;
        const copy = structuredClone(arr) as Entry[];
        if (!rewrite(copy)) continue;
        fixes.push({ table, id: r.id, col, before: r.val, next: wrap ? { ...container, [wrap]: copy } : copy });
      }
    };
    await scan("workout_templates", "exercises");
    await scan("scheduled_workouts", "exercises");
    await scan("routine_entries", "exercises");
    await scan("active_workouts", "workout_data", "exercises");

    const we = await sql`select id from workout_exercises where exercise_id = ${absorb.id}`;
    const pr = await sql`select id from pr_history where exercise_id = ${absorb.id}`;
    const goals = await sql`select id, user_id from exercise_goals where exercise_id = ${absorb.id}`;
    const clash = goals.length
      ? await sql`
          select g.user_id from exercise_goals g
          where g.exercise_id = ${keep.id} and g.user_id in ${sql(goals.map((g) => g.user_id as string))}`
      : [];
    if (clash.length) throw new Error(`a user has goals on BOTH exercises; resolve by hand first`);

    console.log(`history rows to repoint: ${we.length}\npr_history rows: ${pr.length}\nexercise_goals: ${goals.length}`);
    for (const f of fixes) console.log(`inline ${f.table}#${f.id.slice(0, 8)}`);
    if (!APPLY) return;

    const dir = join("migration", "exercise-merge-backups");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `pair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ keep, absorb, absorbRow: (await sql`select * from exercises where id = ${absorb.id}`)[0], we, pr, goals, fixes }, null, 2));
    console.log(`backup: ${file}`);

    await sql.begin(async (tx) => {
      await tx`update workout_exercises set exercise_id = ${keep.id} where exercise_id = ${absorb.id}`;
      await tx`update pr_history set exercise_id = ${keep.id} where exercise_id = ${absorb.id}`;
      await tx`update exercise_goals set exercise_id = ${keep.id} where exercise_id = ${absorb.id}`;
      for (const f of fixes) {
        // sql.json, never JSON.stringify: the latter stores a jsonb STRING.
        await tx`update ${tx(f.table)} set ${tx(f.col)} = ${tx.json(f.next as never)} where id = ${f.id}`;
      }
      await tx`delete from exercises where id = ${absorb.id}`;
    });

    const left = await sql`
      select (select count(*) from workout_exercises where exercise_id = ${absorb.id})::int
           + (select count(*) from pr_history where exercise_id = ${absorb.id})::int
           + (select count(*) from exercise_goals where exercise_id = ${absorb.id})::int
           + (select count(*) from exercises where id = ${absorb.id})::int as n`;
    if (left[0].n !== 0) throw new Error(`VERIFY FAILED: ${left[0].n} references to ${absorb.id} remain`);
    console.log("verified: no references to the absorbed id remain");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
