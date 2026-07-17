import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { exercises, insertExerciseSchema } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { normalizeMuscleGroups } from "@/lib/muscle-groups";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = insertExerciseSchema.partial().parse(await request.json());
  // Same write-path canonicalization as POST (this route was missed when the
  // taxonomy landed, so edits could reintroduce freeform/nested tags).
  if (body.muscleGroups !== undefined) {
    body.muscleGroups = normalizeMuscleGroups(
      Array.isArray(body.muscleGroups)
        ? body.muscleGroups.filter((m): m is string => typeof m === "string")
        : [],
    );
  }

  const [existing] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, id))
    .limit(1);

  if (!existing) throw new ApiError(404, "Exercise not found");
  // Owner-only. Global seed exercises (userId null) are read-only from the app;
  // the previous `!== null` guard let ANY user edit the shared library.
  if (existing.userId !== user.id) {
    throw new ApiError(403, "Not authorized to edit this exercise");
  }

  const [updated] = await db
    .update(exercises)
    .set(body)
    .where(eq(exercises.id, id))
    .returning();
  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const [existing] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, id))
    .limit(1);

  if (!existing) throw new ApiError(404, "Exercise not found");
  if (existing.userId === null) {
    throw new ApiError(403, "Cannot delete global exercises");
  }
  if (existing.userId !== user.id) {
    throw new ApiError(403, "Not authorized to delete this exercise");
  }

  await db.delete(exercises).where(eq(exercises.id, id));
  return new Response(null, { status: 204 });
});
