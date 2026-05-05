import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  routines,
  routineEntries,
  routineInstances,
  scheduledWorkouts,
} from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({
  startDate: z.string(),
  durationDays: z.number().int().positive().optional(),
});

export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = Schema.parse(await request.json());

  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, id))
    .limit(1);
  if (!routine) throw new ApiError(404, "Routine not found");
  if (routine.userId !== user.id && !routine.isPublic) {
    throw new ApiError(403, "Access denied");
  }

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, id));

  const maxDays = body.durationDays ?? routine.defaultDurationDays;
  const filtered = entries.filter(
    (e) => e.dayIndex <= maxDays && e.workoutName,
  );
  if (filtered.length === 0) {
    throw new ApiError(400, "No workout entries found for the specified duration");
  }

  // Check date conflicts
  const existing = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.userId, user.id));
  const existingDates = new Set(
    existing.map((w) => new Date(w.date).toISOString().split("T")[0]),
  );

  const startDate = new Date(body.startDate);
  const conflicts: string[] = [];
  for (const entry of filtered) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + entry.dayIndex - 1);
    const dateStr = d.toISOString().split("T")[0];
    if (existingDates.has(dateStr)) conflicts.push(dateStr);
  }
  if (conflicts.length > 0) {
    throw new ApiError(409, "Scheduling conflicts found", {
      conflicts,
      message: `Workouts already exist on: ${conflicts.join(", ")}`,
    });
  }

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + maxDays - 1);

  const [instance] = await db
    .insert(routineInstances)
    .values({
      routineId: id,
      userId: user.id,
      routineName: routine.name,
      startDate,
      endDate,
      durationDays: maxDays,
      totalWorkouts: filtered.length,
      completedWorkouts: 0,
      status: "active",
    })
    .returning();

  const createdWorkouts = await db
    .insert(scheduledWorkouts)
    .values(
      filtered.map((entry) => {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + entry.dayIndex - 1);
        return {
          userId: user.id,
          name: entry.workoutName || `Day ${entry.dayIndex}`,
          date: d,
          exercises: entry.exercises ?? [],
          templateId: entry.workoutTemplateId ?? null,
          routineInstanceId: instance.id,
          routineDayIndex: entry.dayIndex,
        };
      }),
    )
    .returning();

  // NOTE: Google Calendar event creation deferred to Phase 5b
  return new Response(
    JSON.stringify({
      success: true,
      routineInstance: instance,
      createdCount: createdWorkouts.length,
      workouts: createdWorkouts,
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
});
