import { NextRequest } from "next/server";
import { and, or, eq, isNull, inArray, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { regenerateExerciseImage } from "@/lib/imagen";

/**
 * Bulk-regenerate exercise images via Imagen 4 (Vertex AI). Each regen takes
 * ~10-25s, so we cap the batch tightly to fit Vercel Hobby's 60s function
 * budget. For full-catalog regens use `scripts/regenerate-exercise-images.ts`
 * (CLI, no time limit) instead — this endpoint is for in-app one-off batches.
 *
 * Body (all optional):
 *   ids: string[]            // explicit list; otherwise pull from query
 *   onlyMissingImage: boolean // default true — skip exercises that already have image_url
 *   limit: number            // default 3, hardcap 3 (60s / ~20s = 3)
 *
 * Auth: user must own each target exercise OR it must be a public seed row
 * (userId === null). Anything else returns 403 for that id and the rest run.
 *
 * Returns: { regenerated, failed, skipped, remaining }
 */
export const maxDuration = 60;

const HARD_CAP = 3;

export const POST = handle(async (req: NextRequest) => {
  const { user } = await requireUser();

  let body: { ids?: string[]; onlyMissingImage?: boolean; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const onlyMissingImage = body.onlyMissingImage ?? true;
  const limit = Math.min(body.limit ?? HARD_CAP, HARD_CAP);

  const conditions: SQL[] = [
    or(eq(exercises.userId, user.id), isNull(exercises.userId))!,
  ];
  if (onlyMissingImage) conditions.push(isNull(exercises.imageUrl));
  if (body.ids?.length) conditions.push(inArray(exercises.id, body.ids));

  const targets = await db
    .select()
    .from(exercises)
    .where(conditions.length === 1 ? conditions[0] : and(...conditions));

  // Authorization filter — ownership is already enforced by the SQL above for
  // bulk mode; this loop only runs for explicit-id mode where a non-existent
  // id could be passed in.
  const matchedIds = new Set(targets.map((t) => t.id));
  const skipped: Array<{ id: string; reason: string }> = [];
  if (body.ids) {
    for (const id of body.ids) {
      if (!matchedIds.has(id)) {
        skipped.push({ id, reason: "not found or not authorized" });
      }
    }
  }

  const batch = targets.slice(0, limit);
  const remaining = Math.max(0, targets.length - batch.length);

  const regenerated: Array<{ id: string; imageUrl: string; sizeBytes: number }> = [];
  const failed: Array<{ id: string; error: string }> = [];

  // Serial, not parallel — concurrent Imagen calls would blow past maxDuration.
  for (const ex of batch) {
    try {
      const { imageUrl, sizeBytes } = await regenerateExerciseImage({
        exerciseId: ex.id,
        exerciseName: ex.name,
        description: ex.description ?? undefined,
      });
      await db
        .update(exercises)
        .set({ imageUrl })
        .where(eq(exercises.id, ex.id));
      regenerated.push({ id: ex.id, imageUrl, sizeBytes });
    } catch (e) {
      failed.push({ id: ex.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    regenerated,
    failed,
    skipped,
    remaining,
    note:
      remaining > 0
        ? `${remaining} more exercises match. Call this endpoint again to continue, or use scripts/regenerate-exercise-images.ts for full-catalog runs.`
        : undefined,
  };
});
