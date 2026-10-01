import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";
import { loadExerciseProgress } from "@/lib/api/exercise-progress";

/**
 * One exercise's history as chart points, for the tracker's trend sheet.
 *
 * Ivo, 2026-09-30: "a little button to see the trend line for that exercise
 * during tracking would be neat". The points come from the SAME function the
 * exercise page draws from, so the sheet and the page cannot show two
 * different histories. Asked for only when the sheet is opened.
 *
 * The catalog is shared, so the exercise itself may belong to anyone; the
 * HISTORY is scoped to the caller inside `loadExerciseProgress`.
 */
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const [exercise] = await db
    .select({ id: exercises.id, name: exercises.name, isAssisted: exercises.isAssisted })
    .from(exercises)
    .where(eq(exercises.id, id))
    .limit(1);
  if (!exercise) throw new ApiError(404, "Exercise not found");

  const points = await loadExerciseProgress(user.id, id, {
    isAssisted: !!exercise.isAssisted,
    timeZone: parseTimeZone(request.nextUrl.searchParams.get("tz")),
  });
  return { exerciseName: exercise.name, isAssisted: !!exercise.isAssisted, points };
});
