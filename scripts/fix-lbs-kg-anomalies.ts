/**
 * Apply lbs/kg corrections to completed_workouts.exercises[].setsData[].weight.
 *
 * Pulls findings from `audit-lbs-kg-anomalies.ts` via its --json mode, filters to
 * `high` + `medium` confidence (skip `low` — those are real lighter sets),
 * dumps a JSON backup of every affected workout, then updates the nested
 * JSON via jsonb_set.
 *
 * Run: npx tsx scripts/fix-lbs-kg-anomalies.ts                # dry run
 *      npx tsx scripts/fix-lbs-kg-anomalies.ts --apply        # write + backup
 *      npx tsx scripts/fix-lbs-kg-anomalies.ts --apply --include-low   # also fix low-confidence
 */
import postgres from "postgres";
import { config } from "dotenv";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

config({ path: resolve(process.cwd(), ".env.local") });

const apply = process.argv.includes("--apply");
const includeLow = process.argv.includes("--include-low");

type Finding = {
  email: string;
  workoutId: string;
  completedAt: string;
  workoutName: string;
  exerciseId: string;
  exerciseName: string;
  setIdx: number;
  currentLbs: number;
  proposedLbs: number;
  reps: number;
  medianLbs: number;
  confidence: "high" | "medium" | "low";
};

function loadFindings(): Finding[] {
  const audit = spawnSync(
    "npx",
    ["tsx", "scripts/audit-lbs-kg-anomalies.ts", "--json"],
    { encoding: "utf8" },
  );
  if (audit.status !== 0) {
    console.error(audit.stderr);
    throw new Error("audit failed");
  }
  // dotenv may emit a tip banner on stdout before the JSON; strip everything
  // before the opening bracket of the array.
  const i = audit.stdout.indexOf("[");
  if (i < 0) throw new Error("audit stdout did not contain a JSON array");
  return JSON.parse(audit.stdout.slice(i)) as Finding[];
}

async function main() {
  const allFindings = loadFindings();
  const targets = allFindings.filter(
    (f) => f.confidence === "high" || f.confidence === "medium" || (includeLow && f.confidence === "low"),
  );

  console.log(apply ? "MODE: APPLY" : "MODE: DRY RUN");
  console.log(`Audit findings: ${allFindings.length} total`);
  console.log(`  high: ${allFindings.filter((f) => f.confidence === "high").length}`);
  console.log(`  medium: ${allFindings.filter((f) => f.confidence === "medium").length}`);
  console.log(`  low (excluded): ${allFindings.filter((f) => f.confidence === "low").length}`);
  console.log(`Will fix: ${targets.length}\n`);

  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const SUPA = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

  // Group findings by workoutId so we only read+write each row once.
  const byWorkout = new Map<string, Finding[]>();
  for (const f of targets) {
    let arr = byWorkout.get(f.workoutId);
    if (!arr) {
      arr = [];
      byWorkout.set(f.workoutId, arr);
    }
    arr.push(f);
  }

  // Backup ALL affected workouts before any mutation — single restore point.
  if (apply) {
    const ids = Array.from(byWorkout.keys());
    const backup = await SUPA`
      SELECT id, user_id::text AS user_id, name, completed_at::text AS completed_at, exercises
      FROM completed_workouts
      WHERE id IN ${SUPA(ids)}
    `;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    mkdirSync(resolve(process.cwd(), "migration/lbs-kg-fix-backups"), { recursive: true });
    const path = resolve(
      process.cwd(),
      `migration/lbs-kg-fix-backups/backup-${stamp}.json`,
    );
    writeFileSync(path, JSON.stringify(backup, null, 2));
    console.log(`Backed up ${backup.length} workouts → ${path}\n`);
  }

  // Apply per-workout: jsonb_set each affected set's weight via array index path.
  let fixed = 0;
  for (const [workoutId, fs] of byWorkout) {
    // Need to resolve exercise array index for each finding (we have id, not index)
    const [row] = (await SUPA`
      SELECT exercises FROM completed_workouts WHERE id = ${workoutId}
    `) as { exercises: Array<{ id: string }> }[];
    if (!row) {
      console.log(`  MISSING workout ${workoutId}, skipping`);
      continue;
    }

    for (const f of fs) {
      const exIdx = row.exercises.findIndex((e) => e.id === f.exerciseId);
      if (exIdx < 0) {
        console.log(`  ${f.workoutId.slice(0, 8)} ${f.exerciseName}: exercise not found in jsonb, skip`);
        continue;
      }
      console.log(
        `  ${f.completedAt.slice(0, 16)}  ${f.exerciseName} set ${f.setIdx + 1}: ` +
          `${f.currentLbs} → ${f.proposedLbs} lbs  [${f.confidence}]`,
      );
      if (!apply) continue;
      // jsonb_set with explicit path: {<exIdx>,setsData,<setIdx>,weight}
      // postgres-js: pass the path as a Postgres TEXT[] via sql.unsafe to
      // avoid type coercion issues with array literals.
      const path = `{${exIdx},setsData,${f.setIdx},weight}`;
      const newValueJsonb = String(f.proposedLbs);
      await SUPA.unsafe(
        `UPDATE completed_workouts SET exercises = jsonb_set(exercises, '${path}'::text[], '${newValueJsonb}'::jsonb, false) WHERE id = '${workoutId}'`,
      );
      fixed++;
    }
  }

  await SUPA.end();

  if (!apply) {
    console.log(`\nDry run. Re-run with --apply to write.`);
  } else {
    console.log(`\nApplied ${fixed} fixes across ${byWorkout.size} workouts.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
