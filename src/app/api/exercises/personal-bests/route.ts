import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  exercises,
  workoutExercises,
  workoutSets,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  computeHistoricalBests,
  computeHistoricalHolds,
  type BestRow,
} from "@/lib/pr-bests";
import { usesDistance, usesTime } from "@/lib/exercise-types";
import type { NextRequest } from "next/server";

/**
 * All-time bests for the exercises in the workout being tracked.
 *
 * In-workout PR detection used to derive these in the browser by walking every
 * set the user had ever logged, which is why the workout context had to hold
 * the whole history on every page. This answers the same question for the
 * handful of exercises that are actually being trained.
 *
 * Scoring goes through `lib/pr-bests`, the same functions the hook used, so a
 * PR toast cannot start disagreeing with what it used to say.
 *
 * The ASSISTED flag comes from the CATALOG, not the history snapshot: the
 * completion path did not populate `workout_exercises.is_assisted` until a
 * 2026-07-29 backfill, and on an assisted lift the weight column is
 * counter-assistance, so reading it wrong inverts the record.
 */
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();

  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  if (ids.length === 0) return { bests: {}, holds: {} };

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
          eq(completedWorkouts.userId, user.id),
          inArray(workoutExercises.exerciseId, ids),
          eq(workoutSets.completed, true),
        ),
      ),
  ]);

  const isAssistedById = new Map(catalog.map((e) => [e.id, !!e.isAssisted]));
  const catalogTypeById = new Map(catalog.map((e) => [e.id, e.exerciseType]));

  const isHold = (exerciseType: string | null | undefined, exerciseId: string) => {
    // Prefer the row's own snapshot, fall back to the catalog - the same
    // precedence the tracker uses, and the reason a hold logged before its
    // catalog type changed still scores as a hold.
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

  return {
    bests: Object.fromEntries(computeHistoricalBests(bestRows, isAssistedById)),
    holds: Object.fromEntries(computeHistoricalHolds(bestRows, isHold)),
  };
});
