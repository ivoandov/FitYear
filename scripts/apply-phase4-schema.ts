/**
 * Phase 4 (sets-as-rows): create the additive workout_exercises + workout_sets
 * tables. Idempotent (CREATE TABLE / INDEX IF NOT EXISTS) so it's safe to re-run
 * and never touches existing tables. Run with:
 *   npx tsx --env-file=.env.local scripts/apply-phase4-schema.ts
 */
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS workout_exercises (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        completed_workout_id varchar NOT NULL REFERENCES completed_workouts(id) ON DELETE CASCADE,
        exercise_id varchar NOT NULL,
        position integer NOT NULL,
        name_snapshot text,
        muscle_groups_snapshot jsonb,
        exercise_type text,
        is_assisted boolean
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS workout_exercises_completed_workout_id_idx ON workout_exercises (completed_workout_id);`,
    );
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS workout_sets (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        workout_exercise_id varchar NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
        set_number integer NOT NULL,
        weight_lbs real,
        reps integer,
        distance real,
        time integer,
        completed boolean NOT NULL DEFAULT false
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS workout_sets_workout_exercise_id_idx ON workout_sets (workout_exercise_id);`,
    );

    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('workout_exercises', 'workout_sets')
      order by table_name`;
    console.log(
      "OK - tables present:",
      tables.map((r) => r.table_name).join(", "),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
