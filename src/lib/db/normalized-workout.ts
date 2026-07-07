import { eq } from "drizzle-orm";
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

/**
 * Phase 4 dual-write: mirror a completed workout's exercises + sets into the
 * normalized workout_exercises / workout_sets tables. Replaces any existing
 * normalized rows for the workout (so it's correct for edits too), all in one
 * transaction so a partial normalized state can never exist.
 *
 * IMPORTANT: callers run this BEST-EFFORT (try/catch, report to Sentry) so a
 * failure here can never break the primary jsonb write, which remains the
 * source of truth until reads are switched over (Phase 4c).
 */
export async function writeNormalizedWorkout(
  completedWorkoutId: string,
  exercises: unknown,
): Promise<void> {
  const exs: ExerciseLike[] = Array.isArray(exercises)
    ? (exercises as ExerciseLike[])
    : [];

  await db.transaction(async (tx) => {
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
  });
}
