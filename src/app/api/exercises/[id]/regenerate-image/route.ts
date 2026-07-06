import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
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
  // Owner-only. Regenerating a seed library image from the app was both
  // shared-resource vandalism (it changes the image for every user) and a paid
  // Imagen cost anyone could run up. Seed-image regen stays a CLI job
  // (scripts/regenerate-exercise-images.ts).
  if (existing.userId !== user.id) {
    throw new ApiError(403, "Not authorized to regenerate this exercise");
  }

  // Cap paid Imagen spend per user per day (counts before the paid call).
  await enforceDailyQuota(user.id, "regenerate-image", 20);

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
