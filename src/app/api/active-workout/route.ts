import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { activeWorkouts } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const [row] = await db
    .select()
    .from(activeWorkouts)
    .where(eq(activeWorkouts.userId, user.id))
    .limit(1);
  return row ?? null;
});

const PutSchema = z.object({
  workoutData: z.unknown(),
  trackingProgress: z.unknown().optional().nullable(),
});

export const PUT = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PutSchema.parse(await request.json());

  // Single upsert on the unique user_id. The old SELECT-then-INSERT raced
  // itself: the debounced autosave and the visibilitychange/beforeunload
  // keepalive save can both find no row on a workout's FIRST save, and the
  // loser hit the unique index -> 500, swallowed by the client's .catch().
  const [saved] = await db
    .insert(activeWorkouts)
    .values({
      userId: user.id,
      workoutData: body.workoutData,
      trackingProgress: body.trackingProgress ?? null,
    })
    .onConflictDoUpdate({
      target: activeWorkouts.userId,
      set: {
        workoutData: body.workoutData,
        trackingProgress: body.trackingProgress ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved;
});

export const DELETE = handle(async () => {
  const { user } = await requireUser();
  await db.delete(activeWorkouts).where(eq(activeWorkouts.userId, user.id));
  return new Response(null, { status: 204 });
});
