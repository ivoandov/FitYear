import { NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { completedWorkouts, userSettings, routineInstances } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  isCalendarConnected,
  updateCalendarEvent,
} from "@/lib/calendar";
import { writeNormalizedRows } from "@/lib/db/normalized-workout";

type Ctx = { params: Promise<{ id: string }> };

const PutSchema = z.object({
  name: z.string().min(1).optional(),
  exercises: z.unknown().optional(),
  completedAt: z.string().optional(),
  // The user's local calendar day for completedAt, so the all-day Google
  // Calendar event lands on the day the user picked (not the UTC day).
  localDate: z.string().optional(),
});

async function ownCompleted(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(completedWorkouts)
    .where(eq(completedWorkouts.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "Workout not found");
  if (row.userId !== userId) throw new ApiError(403, "Access denied");
  return row;
}

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownCompleted(id, user.id);
  const body = PutSchema.parse(await request.json());

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.completedAt !== undefined) {
    const nextCompletedAt = new Date(body.completedAt);
    update.completedAt = nextCompletedAt;
    // Move started_at by the same delta. Editing only completed_at left the
    // start behind, producing rows that "started" days after they finished (5
    // in prod before this fix) and a duration_seconds describing the old span.
    // summarizeWorkout falls back to the timestamps when duration is null, so
    // the skew is not purely cosmetic.
    if (existing.startedAt) {
      const delta = nextCompletedAt.getTime() - new Date(existing.completedAt).getTime();
      const nextStartedAt = new Date(new Date(existing.startedAt).getTime() + delta);
      update.startedAt = nextStartedAt;
      update.durationSeconds = Math.max(
        0,
        Math.round((nextCompletedAt.getTime() - nextStartedAt.getTime()) / 1000),
      );
    }
  }

  // Phase 4d: update the row and re-sync its normalized exercises/sets in ONE
  // transaction (the normalized tables are the sole store). A set-write failure
  // rolls the whole edit back rather than leaving the workout half-updated.
  const updated = await db.transaction(async (tx) => {
    let row;
    if (Object.keys(update).length > 0) {
      [row] = await tx
        .update(completedWorkouts)
        .set(update)
        .where(eq(completedWorkouts.id, id))
        .returning();
    } else {
      [row] = await tx
        .select()
        .from(completedWorkouts)
        .where(eq(completedWorkouts.id, id))
        .limit(1);
    }
    if (body.exercises !== undefined) {
      await writeNormalizedRows(tx, id, body.exercises);
    }
    return row;
  });

  // Calendar sync on date change: move the workout's all-day event to the new
  // day (DELETE already removes events; PUT used to leave them on the old day).
  // Same-day edits just re-patch the same date - harmless. A row without an
  // event (calendar connected after the workout) gets one created now.
  if (body.completedAt !== undefined && (await isCalendarConnected(user.id))) {
    const [s] = await db
      .select({ id: userSettings.selectedCalendarId })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    const calendarId = s?.id ?? undefined;
    const newDate = new Date(body.completedAt);
    if (existing.calendarEventId) {
      await updateCalendarEvent(
        user.id,
        existing.calendarEventId,
        newDate,
        calendarId,
        body.localDate,
      );
    } else {
      const eventId = await createCalendarEvent(
        user.id,
        updated.name ?? existing.name,
        newDate,
        calendarId,
        body.localDate,
      );
      if (eventId) {
        await db
          .update(completedWorkouts)
          .set({ calendarEventId: eventId })
          .where(eq(completedWorkouts.id, id));
        updated.calendarEventId = eventId;
      }
    }
  }

  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownCompleted(id, user.id);

  if (existing.calendarEventId && (await isCalendarConnected(user.id))) {
    const [s] = await db
      .select({ id: userSettings.selectedCalendarId })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    await deleteCalendarEvent(user.id, existing.calendarEventId, s?.id ?? undefined);
  }

  await db.transaction(async (tx) => {
    await tx.delete(completedWorkouts).where(eq(completedWorkouts.id, id));
    // routine_instances.completed_workouts is a hand-maintained counter that
    // only ever went UP: deleting a session left it claiming progress that no
    // longer exists (prod had one reading 12 against 0 actual sessions), and
    // the program-progress UI reads it directly.
    if (existing.routineInstanceId) {
      await tx
        .update(routineInstances)
        .set({
          completedWorkouts: sql`greatest(${routineInstances.completedWorkouts} - 1, 0)`,
        })
        .where(
          and(
            eq(routineInstances.id, existing.routineInstanceId),
            eq(routineInstances.userId, user.id),
          ),
        );
    }
  });
  return new Response(null, { status: 204 });
});
