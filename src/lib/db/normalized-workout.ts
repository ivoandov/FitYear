import { eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { workoutExercises, workoutSets } from "@/lib/db/schema";

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

// The transaction handle drizzle hands to db.transaction's callback, so the
// same row-writing logic can run standalone (its own tx) or be composed into a
// caller's transaction (Phase 4d: atomic with the completed_workouts write).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Write a completed workout's exercises + sets into the normalized
 * workout_exercises / workout_sets tables, using the caller's transaction.
 * Replaces any existing normalized rows for the workout (so it's correct for
 * edits too). Since Phase 4d the normalized tables are the SOLE store, so
 * callers run this INSIDE the same transaction as the completed_workouts
 * insert/update — a failure rolls the whole save back (authoritative, not
 * best-effort), so a workout can never persist without its sets.
 */
export async function writeNormalizedRows(
  tx: Tx,
  completedWorkoutId: string,
  exercises: unknown,
): Promise<void> {
  const exs: ExerciseLike[] = Array.isArray(exercises)
    ? (exercises as ExerciseLike[])
    : [];

  // Replace existing rows (cascade drops their sets) so edits re-sync cleanly.
  await tx
    .delete(workoutExercises)
    .where(eq(workoutExercises.completedWorkoutId, completedWorkoutId));

  for (let position = 0; position < exs.length; position++) {
    const ex = exs[position];
    const [we] = await tx
      .insert(workoutExercises)
      .values({
        completedWorkoutId,
        exerciseId: ex.id ?? "",
        position,
        nameSnapshot: ex.name ?? null,
        muscleGroupsSnapshot: (ex.muscleGroups ?? null) as never,
        exerciseType: ex.exerciseType ?? null,
        isAssisted: ex.isAssisted ?? null,
      })
      .returning({ id: workoutExercises.id });

    const sets = Array.isArray(ex.setsData) ? ex.setsData : [];
    if (sets.length > 0) {
      await tx.insert(workoutSets).values(
        sets.map((s, i) => ({
          workoutExerciseId: we.id,
          setNumber: s.setNumber ?? i + 1,
          weightLbs: s.weight ?? null,
          reps: s.reps ?? null,
          distance: s.distance ?? null,
          time: s.time ?? null,
          completed: !!s.completed,
        })),
      );
    }
  }
}

/** Standalone variant: runs its own transaction. */
export async function writeNormalizedWorkout(
  completedWorkoutId: string,
  exercises: unknown,
): Promise<void> {
  await db.transaction((tx) => writeNormalizedRows(tx, completedWorkoutId, exercises));
}

/** One exercise in the same slim shape the API has always returned from jsonb. */
export interface AssembledExercise {
  id: string;
  name: string | null;
  muscleGroups: unknown;
  exerciseType: string | null;
  isAssisted: boolean | null;
  completedSets: number;
  setsData: Array<{
    setNumber: number;
    weight: number | null;
    reps: number | null;
    distance: number | null;
    time: number | null;
    completed: boolean;
  }>;
}

/**
 * Phase 4c read path: assemble the `exercises[]` array for a set of completed
 * workouts from the normalized tables, in the SAME shape the API returned from
 * the jsonb (so client read paths don't change). Returns a Map keyed by
 * completedWorkoutId; a workout absent from the map has no normalized rows and
 * the caller should fall back to its jsonb.
 */
export async function assembleNormalizedExercises(
  completedWorkoutIds: string[],
): Promise<Map<string, AssembledExercise[]>> {
  const out = new Map<string, AssembledExercise[]>();
  if (completedWorkoutIds.length === 0) return out;

  const wes = await db
    .select()
    .from(workoutExercises)
    .where(inArray(workoutExercises.completedWorkoutId, completedWorkoutIds))
    .orderBy(asc(workoutExercises.completedWorkoutId), asc(workoutExercises.position));
  if (wes.length === 0) return out;

  const sets = await db
    .select()
    .from(workoutSets)
    .where(inArray(workoutSets.workoutExerciseId, wes.map((w) => w.id)))
    .orderBy(asc(workoutSets.setNumber));

  const setsByWe = new Map<string, typeof sets>();
  for (const s of sets) {
    const arr = setsByWe.get(s.workoutExerciseId) ?? [];
    arr.push(s);
    setsByWe.set(s.workoutExerciseId, arr);
  }

  // `wes` is ordered by (completedWorkoutId, position), so pushing in order
  // preserves each workout's exercise order.
  for (const we of wes) {
    const setsData = (setsByWe.get(we.id) ?? []).map((s) => ({
      setNumber: s.setNumber,
      weight: s.weightLbs,
      reps: s.reps,
      distance: s.distance,
      time: s.time,
      completed: s.completed,
    }));
    const arr = out.get(we.completedWorkoutId) ?? [];
    arr.push({
      id: we.exerciseId,
      name: we.nameSnapshot,
      muscleGroups: we.muscleGroupsSnapshot,
      exerciseType: we.exerciseType,
      isAssisted: we.isAssisted,
      completedSets: setsData.filter((s) => s.completed).length,
      setsData,
    });
    out.set(we.completedWorkoutId, arr);
  }
  return out;
}
