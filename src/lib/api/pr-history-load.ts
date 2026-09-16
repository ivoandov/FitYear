import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  exercises,
  workoutExercises,
  workoutSets,
} from "@/lib/db/schema";
import {
  computeHistoricalBests,
  computeHistoricalHolds,
  type BestRow,
} from "@/lib/pr-bests";
import { usesDistance, usesTime } from "@/lib/exercise-types";
import type { BestHold } from "@/lib/workout-stats";

/**
 * All-time bests for a specific set of exercises, read in ONE scoped query.
 *
 * Both places that need this used to get it by assembling every set the user
 * had ever logged and walking the result: the tracker did it in the browser,
 * and the workout-summary screen did it server-side on every render. Measured
 * on a real account, that assembly alone was 730ms of a 1,249ms page - and it
 * grows with every workout, so the screen you see after finishing gets slower
 * the longer you use the app.
 *
 * The question is small: for the handful of exercises in ONE workout, what was
 * the best before now. That is what this asks.
 *
 * `before` excludes the workout being summarised, so a session cannot set a
 * record against itself.
 */
export type PrHistoryMaps = {
  bestWeight: Map<string, number>;
  maxVolume: Map<string, number>;
  bestHold: Map<string, BestHold>;
};

export async function loadPrHistoryFor(
  userId: string,
  exerciseIds: string[],
  opts: { before?: Date } = {},
): Promise<PrHistoryMaps> {
  const ids = [...new Set(exerciseIds.filter(Boolean))];
  if (ids.length === 0) {
    return { bestWeight: new Map(), maxVolume: new Map(), bestHold: new Map() };
  }

  const [catalog, rows] = await Promise.all([
    db
      .select({
        id: exercises.id,
        isAssisted: exercises.isAssisted,
        exerciseType: exercises.exerciseType,
      })
      .from(exercises)
      .where(inArray(exercises.id, ids)),
    db
      .select({
        exerciseId: workoutExercises.exerciseId,
        exerciseType: workoutExercises.exerciseType,
        weight: workoutSets.weightLbs,
        reps: workoutSets.reps,
        time: workoutSets.time,
        completed: workoutSets.completed,
      })
      .from(workoutExercises)
      .innerJoin(workoutSets, eq(workoutSets.workoutExerciseId, workoutExercises.id))
      .innerJoin(
        completedWorkouts,
        eq(completedWorkouts.id, workoutExercises.completedWorkoutId),
      )
      .where(
        and(
          eq(completedWorkouts.userId, userId),
          inArray(workoutExercises.exerciseId, ids),
          eq(workoutSets.completed, true),
          ...(opts.before ? [lt(completedWorkouts.completedAt, opts.before)] : []),
        ),
      ),
  ]);

  // The ASSISTED flag comes from the CATALOG, not the history snapshot: the
  // completion path did not populate `workout_exercises.is_assisted` until a
  // 2026-07-29 backfill, and on an assisted lift the weight column is
  // counter-assistance, so reading it wrong inverts the record.
  const isAssistedById = new Map(catalog.map((e) => [e.id, !!e.isAssisted]));
  const catalogTypeById = new Map(catalog.map((e) => [e.id, e.exerciseType]));
  const isHold = (exerciseType: string | null | undefined, exerciseId: string) => {
    const t = exerciseType ?? catalogTypeById.get(exerciseId) ?? null;
    return usesTime(t) && !usesDistance(t);
  };

  const bestRows: BestRow[] = rows.map((r) => ({
    exerciseId: r.exerciseId,
    exerciseType: r.exerciseType,
    weight: r.weight,
    reps: r.reps,
    time: r.time,
    completed: r.completed,
  }));

  const bests = computeHistoricalBests(bestRows, isAssistedById);
  return {
    bestWeight: new Map([...bests].map(([id, b]) => [id, b.bestWeight])),
    maxVolume: new Map([...bests].map(([id, b]) => [id, b.maxVolume])),
    bestHold: computeHistoricalHolds(bestRows, isHold),
  };
}

/** The assisted flags for just these exercises, for the caller's own scoring. */
export async function loadAssistedFlags(
  exerciseIds: string[],
): Promise<Map<string, boolean>> {
  const ids = [...new Set(exerciseIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: exercises.id, isAssisted: exercises.isAssisted })
    .from(exercises)
    .where(inArray(exercises.id, ids));
  return new Map(rows.map((e) => [e.id, !!e.isAssisted]));
}
