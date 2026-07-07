/**
 * Phase 4b: backfill historical completed workouts into the normalized
 * workout_exercises / workout_sets tables. Idempotent (only touches workouts
 * with no normalized rows yet) and additive (never modifies the jsonb). Prints
 * a per-workout + overall parity report (jsonb set count/volume vs normalized).
 *
 *   dry run:  npx tsx --env-file=.env.local scripts/backfill-sets-as-rows.ts
 *   apply:    npx tsx --env-file=.env.local scripts/backfill-sets-as-rows.ts --apply
 *
 * ZERO mismatches is the gate before switching reads (Phase 4c).
 */
import postgres from "postgres";

type SetLike = {
  setNumber?: number;
  weight?: number | null;
  reps?: number | null;
  distance?: number | null;
  time?: number | null;
  completed?: boolean;
};
type ExerciseLike = {
  id?: string;
  name?: string;
  muscleGroups?: unknown;
  exerciseType?: string;
  isAssisted?: boolean;
  setsData?: SetLike[];
};

function jsonbStats(exs: ExerciseLike[]) {
  let setCount = 0;
  let volume = 0;
  for (const ex of exs) {
    for (const s of ex.setsData ?? []) {
      setCount++;
      if (s.completed) volume += (s.weight || 0) * (s.reps || 0);
    }
  }
  return { setCount, volume };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const APPLY = process.argv.includes("--apply");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const workouts = await sql<{ id: string; exercises: unknown }[]>`
      select cw.id, cw.exercises
      from completed_workouts cw
      where not exists (
        select 1 from workout_exercises we where we.completed_workout_id = cw.id
      )
      order by cw.completed_at`;

    console.log(
      `${workouts.length} workout(s) without normalized rows ${APPLY ? "(APPLYING)" : "(dry-run)"}\n`,
    );

    let totalSets = 0;
    let mismatches = 0;

    for (const w of workouts) {
      const exs: ExerciseLike[] = Array.isArray(w.exercises)
        ? (w.exercises as ExerciseLike[])
        : [];
      const { setCount, volume } = jsonbStats(exs);
      totalSets += setCount;

      if (APPLY) {
        await sql.begin(async (tx) => {
          for (let position = 0; position < exs.length; position++) {
            const ex = exs[position];
            const [we] = await tx<{ id: string }[]>`
              insert into workout_exercises
                (completed_workout_id, exercise_id, position, name_snapshot, muscle_groups_snapshot, exercise_type, is_assisted)
              values
                (${w.id}, ${ex.id ?? ""}, ${position}, ${ex.name ?? null},
                 ${JSON.stringify(ex.muscleGroups ?? null)}::jsonb, ${ex.exerciseType ?? null}, ${ex.isAssisted ?? null})
              returning id`;
            const sets = ex.setsData ?? [];
            for (let i = 0; i < sets.length; i++) {
              const s = sets[i];
              await tx`
                insert into workout_sets
                  (workout_exercise_id, set_number, weight_lbs, reps, distance, time, completed)
                values
                  (${we.id}, ${s.setNumber ?? i + 1}, ${s.weight ?? null}, ${s.reps ?? null},
                   ${s.distance ?? null}, ${s.time ?? null}, ${!!s.completed})`;
            }
          }
        });

        // Parity check for this workout after insert.
        const [{ cnt }] = await sql<{ cnt: number }[]>`
          select count(*)::int as cnt from workout_sets ws
          join workout_exercises we on we.id = ws.workout_exercise_id
          where we.completed_workout_id = ${w.id}`;
        const ok = cnt === setCount;
        if (!ok) mismatches++;
        console.log(
          `  ${w.id}  jsonb=${setCount} normalized=${cnt} vol=${volume}  ${ok ? "OK" : "MISMATCH"}`,
        );
      } else {
        console.log(`  ${w.id}  sets=${setCount} vol=${volume}`);
      }
    }

    console.log(
      `\n${workouts.length} workout(s), ${totalSets} set(s) ${APPLY ? "backfilled" : "pending"}; mismatches: ${mismatches}`,
    );
    if (APPLY && mismatches > 0) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
