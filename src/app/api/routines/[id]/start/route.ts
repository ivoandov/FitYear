import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
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
import { isUniqueViolation } from "@/lib/api/pg-errors";

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

  // One transaction: the instance and its scheduled workouts must land
  // together. Separately, a failed bulk insert left an ACTIVE instance
  // claiming N workouts with nothing on the calendar.
  let instance: typeof routineInstances.$inferSelect;
  let createdWorkouts: (typeof scheduledWorkouts.$inferSelect)[];
  try {
    ({ instance, createdWorkouts } = await db.transaction(async (tx) => {
    const [inst] = await tx
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

    const created = await tx
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
            routineInstanceId: inst.id,
            routineDayIndex: entry.dayIndex,
          };
        }),
      )
      .returning();

      return { instance: inst, createdWorkouts: created };
    }));
  } catch (e) {
    // The partial unique index (one ACTIVE instance per user+routine) rejected
    // this one, i.e. a double-tap on Start where both requests cleared the
    // date-conflict pre-check. Return the instance that won instead of a 500,
    // so the second tap is a no-op rather than a double-booked program.
    if (isUniqueViolation(e)) {
      const [winner] = await db
        .select()
        .from(routineInstances)
        .where(
          and(
            eq(routineInstances.userId, user.id),
            eq(routineInstances.routineId, id),
            eq(routineInstances.status, "active"),
          ),
        )
        .limit(1);
      if (winner) {
        throw new ApiError(409, "This routine is already running", {
          routineInstanceId: winner.id,
        });
      }
    }
    throw e;
  }

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
