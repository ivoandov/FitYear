import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  exercises,
  hasCustomMuscleGroup,
  insertExerciseSchema,
} from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = insertExerciseSchema.partial().parse(await request.json());

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

  const update: typeof body & { isPublic?: boolean } = { ...body };
  if (body.muscleGroups !== undefined) {
    update.isPublic = !hasCustomMuscleGroup(
      (body.muscleGroups as string[] | undefined) ?? [],
    );
  }

  const [updated] = await db
    .update(exercises)
    .set(update)
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
