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
import { addDaysToDateKey, localDateKeyInZone, scheduledDateFromKey } from "@/lib/date";
import { viewerTimeZone } from "@/lib/server-timezone";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({
  // Must be a real date: an unparseable string became `Invalid Date`, and the
  // conflict loop's `d.toISOString()` then threw a RangeError as a generic 500.
  startDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "startDate must be a valid date"),
  durationDays: z.number().int().positive().max(366).optional(),
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
  // The calendar day the user picked, resolved in THEIR zone rather than the
  // server's (UTC on Vercel). Every date below is derived from this KEY by
  // calendar arithmetic, so no step ever depends on a machine's local clock.
  const startKey = localDateKeyInZone(startDate, await viewerTimeZone());

  const conflicts: string[] = [];
  for (const entry of filtered) {
    const dateStr = addDaysToDateKey(startKey, entry.dayIndex - 1);
    if (existingDates.has(dateStr)) conflicts.push(dateStr);
  }
  if (conflicts.length > 0) {
    throw new ApiError(409, "Scheduling conflicts found", {
      conflicts,
      message: `Workouts already exist on: ${conflicts.join(", ")}`,
    });
  }

  const endDate = scheduledDateFromKey(addDaysToDateKey(startKey, maxDays - 1));

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
          // Calendar arithmetic on the DAY KEY, then anchored at noon UTC.
          // This used to add days to a Date and store the result, which is
          // local midnight - 07:00Z for Los Angeles - and any zone west of the
          // creating one then read it as the previous day. See
          // scheduledDateFromKey.
          const d = scheduledDateFromKey(
            addDaysToDateKey(startKey, entry.dayIndex - 1),
          );
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
