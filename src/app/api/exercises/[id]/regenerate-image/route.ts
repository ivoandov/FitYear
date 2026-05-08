import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { regenerateExerciseImage } from "@/lib/imagen";

// Imagen 4 calls take ~10-25s. The default Hobby maxDuration is 10s, so
// bump it. Sharp resize + GCS upload after generation are < 1s combined.
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const [existing] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, id))
    .limit(1);

  if (!existing) throw new ApiError(404, "Exercise not found");
  // Public exercises (userId === null) are part of the seeded library and
  // anyone can regen their image; user exercises only by their owner.
  if (existing.userId !== null && existing.userId !== user.id) {
    throw new ApiError(403, "Not authorized to regenerate this exercise");
  }

  const { imageUrl, sizeBytes } = await regenerateExerciseImage({
    exerciseId: existing.id,
    exerciseName: existing.name,
    description: existing.description ?? undefined,
  });

  const [updated] = await db
    .update(exercises)
    .set({ imageUrl })
    .where(eq(exercises.id, id))
    .returning();

  return { ...updated, _meta: { sizeBytes } };
});
