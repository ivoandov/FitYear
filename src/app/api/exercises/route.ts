import { NextRequest } from "next/server";
import { eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  exercises,
  hasCustomMuscleGroup,
  insertExerciseSchema,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Per-user response — never cache.
export const dynamic = "force-dynamic";

/**
 * Returns:
 *   - all rows where user_id IS NULL (the seeded global library)
 *   - plus rows owned by the current user
 *   - plus any row flagged is_public = true (matches the Replit picker behavior;
 *     34 migrated rows have non-null user_id but is_public=true)
 *
 * Legacy image_url paths (`/objects/public/...` or `/generated_images/...`)
 * are rewritten on the way out to point at the GCS proxy at `/api/objects/...`.
 * The DB is not mutated — this is a presentation-layer translation.
 */
function rewriteImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/objects/")) return `/api${url}`;
  if (url.startsWith("/generated_images/")) {
    return `/api/objects/exercises/${url.replace("/generated_images/", "")}`;
  }
  return url;
}

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(exercises)
    .where(
      or(
        isNull(exercises.userId),
        eq(exercises.userId, user.id),
        eq(exercises.isPublic, true),
      ),
    );
  console.log(
    `[GET /api/exercises] user=${user.id} count=${rows.length} hasPushups=${rows.some((r) => r.name === "Pushups")}`,
  );
  return rows.map((r) => ({ ...r, imageUrl: rewriteImageUrl(r.imageUrl) }));
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
