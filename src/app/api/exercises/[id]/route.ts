import { NextRequest } from "next/server";
import { z } from "zod";
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
  // `userId` and `isPublic` are ownership fields, never client input. Without
  // the omit they were spread straight into .set(): posting `userId: null`
  // turned your own exercise into a global seed row that NOBODY can then edit
  // or delete (both guards below reject it), and posting another user's id
  // handed the row to them.
  const body = insertExerciseSchema
    .omit({ userId: true, isPublic: true })
    .extend({ name: z.string().trim().min(1).max(60) })
    .partial()
    .parse(await request.json());
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

  // Nothing updatable left (e.g. the body carried only ownership fields, which
  // are stripped above). Drizzle throws "No values to set" on an empty .set().
  if (Object.keys(body).length === 0) return existing;

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
