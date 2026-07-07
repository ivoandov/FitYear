/**
 * Phase 4d schema cutover — the normalized workout_exercises/workout_sets tables
 * become the sole store; the completed_workouts.exercises jsonb is retired.
 * Run the steps individually, in order:
 *
 *   --step drop-not-null : make completed_workouts.exercises nullable. Prereq for
 *                          deploying the code that stops writing the jsonb (old
 *                          rows keep their blob; new inserts may omit it). SAFE.
 *   --step rename-legacy : rename exercises -> exercises_legacy. Parachute — the
 *                          raw data is preserved and recoverable (rename back).
 *                          Run only AFTER the stop-writing code is deployed +
 *                          verified, so no running code references `exercises`.
 *   --step drop-legacy   : DROP COLUMN exercises_legacy. IRREVERSIBLE byte-level
 *                          deletion. Only with a fresh backup + explicit sign-off.
 *
 *   npx tsx --env-file=.env.local scripts/phase4d-schema.ts --step <step>
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const i = process.argv.indexOf("--step");
  const step = i >= 0 ? process.argv[i + 1] : "";
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    if (step === "drop-not-null") {
      await sql.unsafe(`ALTER TABLE completed_workouts ALTER COLUMN exercises DROP NOT NULL`);
    } else if (step === "rename-legacy") {
      await sql.unsafe(`ALTER TABLE completed_workouts RENAME COLUMN exercises TO exercises_legacy`);
    } else if (step === "drop-legacy") {
      await sql.unsafe(`ALTER TABLE completed_workouts DROP COLUMN exercises_legacy`);
    } else {
      throw new Error(`unknown --step "${step}" (drop-not-null | rename-legacy | drop-legacy)`);
    }
    const cols = await sql<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'completed_workouts'
        and column_name in ('exercises', 'exercises_legacy')`;
    console.log(
      `step '${step}' OK. matching columns: ${
        cols.map((c) => `${c.column_name}(nullable=${c.is_nullable})`).join(", ") || "(none)"
      }`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
