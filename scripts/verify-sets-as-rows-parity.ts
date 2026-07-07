/**
 * Phase 4c/4d gate: verify the normalized assembly matches the jsonb for EVERY
 * completed workout. Compares the sequence of (exercise id, per-set weight /
 * reps / distance / time / completed) between the stored jsonb and the
 * normalized tables. Weight uses a small tolerance (weightLbs is a single-
 * precision `real`, so 1-decimal values like 44.1 round-trip to ~44.0999; the
 * app rounds to 1 decimal on display, so this is invisible to users).
 *
 *   npx tsx --env-file=.env.local scripts/verify-sets-as-rows-parity.ts
 *
 * ZERO mismatches is the gate to switch reads / drop the column.
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
type ExLike = { id?: string; setsData?: SetLike[] };

const WEIGHT_EPS = 0.01;
const eqNum = (a: number | null | undefined, b: number | null | undefined, eps = 0) =>
  ((a ?? 0) === (b ?? 0)) || Math.abs((a ?? 0) - (b ?? 0)) <= eps;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const workouts = await sql<{ id: string; exercises: unknown }[]>`
      select id, exercises from completed_workouts order by completed_at`;

    let mismatches = 0;
    let checked = 0;

    for (const w of workouts) {
      const jsonbExs: ExLike[] = Array.isArray(w.exercises) ? (w.exercises as ExLike[]) : [];

      const wes = await sql<{ id: string; exercise_id: string; position: number }[]>`
        select id, exercise_id, position from workout_exercises
        where completed_workout_id = ${w.id} order by position`;
      const norm: ExLike[] = [];
      for (const we of wes) {
        const sets = await sql<SetLike[]>`
          select set_number as "setNumber", weight_lbs as weight, reps, distance, time, completed
          from workout_sets where workout_exercise_id = ${we.id} order by set_number`;
        norm.push({ id: we.exercise_id, setsData: sets });
      }

      // Compare exercise-by-exercise, set-by-set.
      const problems: string[] = [];
      if (jsonbExs.length !== norm.length) {
        problems.push(`exercise count ${jsonbExs.length} vs ${norm.length}`);
      }
      const n = Math.min(jsonbExs.length, norm.length);
      for (let i = 0; i < n; i++) {
        const j = jsonbExs[i];
        const m = norm[i];
        if ((j.id ?? "") !== (m.id ?? "")) problems.push(`ex[${i}] id ${j.id} vs ${m.id}`);
        const js = j.setsData ?? [];
        const ms = m.setsData ?? [];
        if (js.length !== ms.length) problems.push(`ex[${i}] set count ${js.length} vs ${ms.length}`);
        const sn = Math.min(js.length, ms.length);
        for (let k = 0; k < sn; k++) {
          const a = js[k];
          const b = ms[k];
          if (!eqNum(a.weight, b.weight, WEIGHT_EPS)) problems.push(`ex[${i}].set[${k}] weight ${a.weight} vs ${b.weight}`);
          if (!eqNum(a.reps, b.reps)) problems.push(`ex[${i}].set[${k}] reps ${a.reps} vs ${b.reps}`);
          if (!eqNum(a.distance, b.distance, WEIGHT_EPS)) problems.push(`ex[${i}].set[${k}] distance ${a.distance} vs ${b.distance}`);
          if (!eqNum(a.time, b.time)) problems.push(`ex[${i}].set[${k}] time ${a.time} vs ${b.time}`);
          if (!!a.completed !== !!b.completed) problems.push(`ex[${i}].set[${k}] completed ${a.completed} vs ${b.completed}`);
        }
      }

      checked++;
      if (problems.length) {
        mismatches++;
        console.log(`MISMATCH ${w.id}:`);
        for (const p of problems.slice(0, 6)) console.log(`   - ${p}`);
      }
    }

    console.log(`\nChecked ${checked} workouts; mismatches: ${mismatches}`);
    if (mismatches > 0) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
