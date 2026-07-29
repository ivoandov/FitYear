import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { canRegenerateImage } from "@/lib/photo-admin";
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
  // Owner, or an allowlisted photo admin. Regenerating a shared image is both
  // shared-resource vandalism (it changes the image for EVERY user) and a paid
  // Imagen call, so this stays closed to the general user; the allowlist exists
  // because the 2026-07-17 dedupe left most merged survivors owned by the
  // global library or the other user. Renames, re-tags and deletes remain
  // strictly owner-only. Daily quota below still applies.
  if (!canRegenerateImage(user.id, existing.userId)) {
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
