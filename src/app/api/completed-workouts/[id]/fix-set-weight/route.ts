import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { completedWorkouts } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

/**
 * Single-row weight correction inside completed_workouts.exercises JSON.
 *
 * Used by the exercise progress chart to let users one-click-fix anomalies
 * (typically kg-saved-as-lbs rows). The body's `newWeight` is the final
 * lbs value to store — the client does the kg→lbs multiplication.
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

  // Verify ownership + resolve the array index of the exercise
  const [row] = await db
    .select({ exercises: completedWorkouts.exercises })
    .from(completedWorkouts)
    .where(and(eq(completedWorkouts.id, workoutId), eq(completedWorkouts.userId, user.id)))
    .limit(1);
  if (!row) throw new ApiError(404, "Workout not found or not owned by you");

  const exs = (row.exercises as Array<{ id: string; setsData?: Array<{ weight?: number }> }>) ?? [];
  const exIdx = exs.findIndex((e) => e.id === exerciseId);
  if (exIdx < 0) throw new ApiError(404, "Exercise not present in this workout");
  const sets = exs[exIdx].setsData;
  if (!sets || setIdxNum >= sets.length) {
    throw new ApiError(404, `Set ${setIdxNum} not present (exercise has ${sets?.length ?? 0} sets)`);
  }

  const oldWeight = sets[setIdxNum].weight ?? 0;

  // jsonb_set at path {exIdx,setsData,setIdx,weight}. exIdx + setIdxNum are
  // server-validated integers, safe to interpolate via sql.raw into the
  // structural path. Workout id + user id flow through parameter binding.
  const pathLiteral = `'{${exIdx},setsData,${setIdxNum},weight}'::text[]`;
  const newWeightLiteral = `${newWeight}::jsonb`;
  await db.execute(sql`
    UPDATE completed_workouts
    SET exercises = jsonb_set(exercises, ${sql.raw(pathLiteral)}, ${sql.raw(newWeightLiteral)}, false)
    WHERE id = ${workoutId} AND user_id = ${user.id}::uuid
  `);

  return { ok: true, exerciseId, setIdx: setIdxNum, oldWeight, newWeight };
});
