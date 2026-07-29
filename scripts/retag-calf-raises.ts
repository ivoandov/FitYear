/**
 * Tag the calf-raise exercises with the CALVES specific instead of bare "Legs".
 *
 * Both catalog rows ("Calf Raises - Flat", "Calf Raises - Standing Machine")
 * carried `["Legs"]`, so calf work rolled up correctly at the coarse level but
 * never appeared as Calves anywhere - the History card's Detailed view showed no
 * Calves row, and the exercise subtitle read "Legs" instead of "Legs (Calves)".
 * `resolveMuscle("Calves") -> { label: "Calves", coarse: "Legs" }`, so this is
 * lossless: the Legs rollup is unchanged and only the detail is added.
 *
 * History snapshots are updated too (5 rows), so PAST sessions show the calf
 * detail as well. That is safe here because the coarse rollup is identical
 * either way - unlike `name_snapshot`, which stays untouched by design (it
 * records what the exercise was called at the time).
 *
 * House pattern: dry-run default / `--apply`, gitignored backup, one
 * transaction, self-verifying, idempotent (a second run reports 0 changes).
 */
import postgres from "postgres";
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

config({ path: path.join(__dirname, "..", ".env.local") });

const TARGET = ["Calves"];
const APPLY = process.argv.includes("--apply");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const catalog = await sql`
      select id, name, muscle_groups from exercises
      where name ilike 'calf raise%' or name ilike '% calf raise%'`;
    const history = await sql`
      select we.id, we.name_snapshot, we.muscle_groups_snapshot
      from workout_exercises we
      where we.name_snapshot ilike 'calf raise%'`;

    const catalogToFix = catalog.filter(
      (r) => JSON.stringify(r.muscle_groups) !== JSON.stringify(TARGET),
    );
    const historyToFix = history.filter(
      (r) => JSON.stringify(r.muscle_groups_snapshot) !== JSON.stringify(TARGET),
    );

    console.log(`catalog rows matching: ${catalog.length}, needing retag: ${catalogToFix.length}`);
    for (const r of catalogToFix) console.log("  -", r.name, JSON.stringify(r.muscle_groups), "->", JSON.stringify(TARGET));
    console.log(`history rows matching: ${history.length}, needing retag: ${historyToFix.length}`);

    if (catalogToFix.length === 0 && historyToFix.length === 0) {
      console.log("Nothing to do (idempotent re-run).");
      return;
    }
    if (!APPLY) {
      console.log("DRY RUN - no changes. Re-run with --apply.");
      return;
    }

    const dir = path.join(__dirname, "..", "migration", "calf-retag-backups");
    mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(backup, JSON.stringify({ catalog, history }, null, 2));
    console.log("Backup:", backup);

    await sql.begin(async (tx) => {
      for (const r of catalogToFix) {
        await tx`update exercises set muscle_groups = ${tx.json(TARGET)} where id = ${r.id}`;
      }
      for (const r of historyToFix) {
        await tx`update workout_exercises set muscle_groups_snapshot = ${tx.json(TARGET)} where id = ${r.id}`;
      }
    });

    const badCatalog = await sql`
      select count(*)::int c from exercises
      where (name ilike 'calf raise%' or name ilike '% calf raise%')
        and muscle_groups::text <> ${JSON.stringify(TARGET)}`;
    const badHistory = await sql`
      select count(*)::int c from workout_exercises
      where name_snapshot ilike 'calf raise%'
        and muscle_groups_snapshot::text <> ${JSON.stringify(TARGET)}`;
    if (badCatalog[0].c > 0 || badHistory[0].c > 0) {
      throw new Error(`VERIFY FAILED: catalog ${badCatalog[0].c}, history ${badHistory[0].c} still untagged`);
    }
    console.log(`APPLIED + VERIFIED: ${catalogToFix.length} catalog + ${historyToFix.length} history rows now tagged Calves.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
