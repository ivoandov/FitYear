import { NextRequest } from "next/server";
import { eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  exercises,
  hasCustomMuscleGroup,
  insertExerciseSchema,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

/**
 * Returns:
 *   - all rows where user_id IS NULL (the seeded global library)
 *   - plus rows owned by the current user
 *
 * Image URL post-processing (signed URLs / GCS proxy) lands in Phase 4.
 * For now image_url is returned as-stored.
 */
export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(exercises)
    .where(or(isNull(exercises.userId), eq(exercises.userId, user.id)));
  return rows;
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const parsed = insertExerciseSchema.parse(await request.json());
  const muscleGroups = (parsed.muscleGroups as string[] | undefined) ?? [];
  const isPublic = !hasCustomMuscleGroup(muscleGroups);

  const [created] = await db
    .insert(exercises)
    .values({
      ...parsed,
      userId: user.id,
      isPublic,
    })
    .returning();

  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
