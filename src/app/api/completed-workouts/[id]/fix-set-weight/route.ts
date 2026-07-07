import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { completedWorkouts, workoutExercises, workoutSets } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

/**
 * Single-set weight correction, applied authoritatively to the normalized
 * workout_sets row (Phase 4d — no jsonb).
 *
 * Used by the exercise progress chart to one-click-fix anomalies (typically
 * kg-saved-as-lbs rows). `newWeight` is the final lbs value to store — the
 * client does the kg->lbs multiplication.
 *
 * `setIdx` is the enumeration index over the exercise's sets in set_number
 * order (the same order the assembled read path returns, which the chart
 * indexes). The exercise is resolved by its first occurrence in position order,
 * matching how the progress page (`exs.find(e => e.id === id)`) picks it.
 *
 * POST /api/completed-workouts/[id]/fix-set-weight
 *   Body: { exerciseId: string, setIdx: number, newWeight: number }
 *   Auth: user must own the workout.
 */
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id: workoutId } = await ctx.params;

  let body: { exerciseId?: unknown; setIdx?: unknown; newWeight?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const { exerciseId, setIdx, newWeight } = body;
  if (
    typeof exerciseId !== "string" ||
    !exerciseId ||
    !Number.isInteger(setIdx) ||
    (setIdx as number) < 0 ||
    typeof newWeight !== "number" ||
    !Number.isFinite(newWeight) ||
    newWeight < 0 ||
    newWeight > 5000
  ) {
    throw new ApiError(
      400,
      "Body must be { exerciseId: string, setIdx: integer >= 0, newWeight: number in [0, 5000] }",
    );
  }
  const setIdxNum = setIdx as number;

  // Ownership: workout must belong to the caller.
  const [owned] = await db
    .select({ id: completedWorkouts.id })
    .from(completedWorkouts)
    .where(and(eq(completedWorkouts.id, workoutId), eq(completedWorkouts.userId, user.id)))
    .limit(1);
  if (!owned) throw new ApiError(404, "Workout not found or not owned by you");

  // Resolve the exercise: first occurrence in position order (matches the chart).
  const wes = await db
    .select({ id: workoutExercises.id, exerciseId: workoutExercises.exerciseId })
    .from(workoutExercises)
    .where(eq(workoutExercises.completedWorkoutId, workoutId))
    .orderBy(asc(workoutExercises.position));
  const we = wes.find((w) => w.exerciseId === exerciseId);
  if (!we) throw new ApiError(404, "Exercise not present in this workout");

  // The setIdx-th set in set_number order.
  const sets = await db
    .select({ id: workoutSets.id, weightLbs: workoutSets.weightLbs })
    .from(workoutSets)
    .where(eq(workoutSets.workoutExerciseId, we.id))
    .orderBy(asc(workoutSets.setNumber));
  if (setIdxNum >= sets.length) {
    throw new ApiError(404, `Set ${setIdxNum} not present (exercise has ${sets.length} sets)`);
  }
  const target = sets[setIdxNum];
  const oldWeight = target.weightLbs ?? 0;

  await db
    .update(workoutSets)
    .set({ weightLbs: newWeight })
    .where(eq(workoutSets.id, target.id));

  return { ok: true, exerciseId, setIdx: setIdxNum, oldWeight, newWeight };
});
