import { NextRequest } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  scheduledWorkouts,
  routineInstances,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, user.id))
    .orderBy(desc(completedWorkouts.completedAt));
  return rows;
});

const PostSchema = z.object({
  displayId: z.string().min(1),
  name: z.string().min(1),
  exercises: z.unknown(),
  completedAt: z.string().optional(),
  startedAt: z.string().optional(),
  durationSeconds: z.number().int().optional(),
  scheduledWorkoutId: z.string().optional(),
  templateId: z.string().nullable().optional(),
  localDate: z.string().optional(), // accepted but unused server-side; calendar sync deferred to Phase 5b
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  // Resolve templateId from the scheduled workout if not provided
  let templateId = body.templateId ?? null;
  let scheduledRoutineInstanceId: string | null = null;
  if (body.scheduledWorkoutId) {
    const [sw] = await db
      .select()
      .from(scheduledWorkouts)
      .where(eq(scheduledWorkouts.id, body.scheduledWorkoutId))
      .limit(1);
    if (sw) {
      if (!templateId) templateId = sw.templateId ?? null;
      scheduledRoutineInstanceId = sw.routineInstanceId ?? null;
    }
  }

  const [created] = await db
    .insert(completedWorkouts)
    .values({
      userId: user.id,
      templateId,
      displayId: body.displayId,
      name: body.name,
      exercises: body.exercises,
      completedAt: body.completedAt ? new Date(body.completedAt) : new Date(),
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      durationSeconds: body.durationSeconds ?? null,
      routineInstanceId: scheduledRoutineInstanceId,
    })
    .returning();

  // Increment routine progress if the source scheduled workout was part of a routine
  if (scheduledRoutineInstanceId) {
    await db
      .update(routineInstances)
      .set({
        completedWorkouts: sql`${routineInstances.completedWorkouts} + 1`,
      })
      .where(eq(routineInstances.id, scheduledRoutineInstanceId));
  }

  // NOTE: calendar sync deferred to Phase 5b
  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
