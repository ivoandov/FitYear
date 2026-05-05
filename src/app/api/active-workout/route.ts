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

  const [existing] = await db
    .select()
    .from(activeWorkouts)
    .where(eq(activeWorkouts.userId, user.id))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(activeWorkouts)
      .set({
        workoutData: body.workoutData,
        trackingProgress: body.trackingProgress ?? null,
        updatedAt: new Date(),
      })
      .where(eq(activeWorkouts.userId, user.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(activeWorkouts)
    .values({
      userId: user.id,
      workoutData: body.workoutData,
      trackingProgress: body.trackingProgress ?? null,
    })
    .returning();
  return created;
});

export const DELETE = handle(async () => {
  const { user } = await requireUser();
  await db.delete(activeWorkouts).where(eq(activeWorkouts.userId, user.id));
  return new Response(null, { status: 204 });
});
