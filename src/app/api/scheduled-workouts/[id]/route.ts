import { NextRequest } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { scheduledWorkouts, userSettings } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  isCalendarConnected,
  updateCalendarEvent,
} from "@/lib/calendar";

async function getSelectedCalendarId(userId: string): Promise<string | undefined> {
  const [s] = await db
    .select({ id: userSettings.selectedCalendarId })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return s?.id ?? undefined;
}

type Ctx = { params: Promise<{ id: string }> };

const PutSchema = z.object({
  name: z.string().min(1).optional(),
  date: z.string().optional(),
  localDate: z.string().optional(),
  exercises: z.unknown().optional(),
  templateId: z.string().nullable().optional(),
  routineInstanceId: z.string().nullable().optional(),
  routineDayIndex: z.number().int().nullable().optional(),
});

async function ownScheduled(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "Workout not found");
  if (row.userId !== userId) throw new ApiError(403, "Access denied");
  return row;
}

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownScheduled(id, user.id);
  const body = PutSchema.parse(await request.json());

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.exercises !== undefined) update.exercises = body.exercises;
  if (body.templateId !== undefined) update.templateId = body.templateId;
  if (body.routineInstanceId !== undefined)
    update.routineInstanceId = body.routineInstanceId;
  if (body.routineDayIndex !== undefined)
    update.routineDayIndex = body.routineDayIndex;
  if (body.localDate) {
    update.date = new Date(`${body.localDate}T12:00:00Z`);
  } else if (body.date) {
    update.date = new Date(body.date);
  }

  // If name changed, propagate to sibling rows in the same routine/template
  // (preserves the original "rename future occurrences" behavior).
  if (body.name && body.name !== existing.name) {
    if (existing.routineInstanceId) {
      await db
        .update(scheduledWorkouts)
        .set({ name: body.name })
        .where(
          and(
            eq(scheduledWorkouts.routineInstanceId, existing.routineInstanceId),
            eq(scheduledWorkouts.name, existing.name),
            ne(scheduledWorkouts.id, id),
          ),
        );
    } else if (existing.templateId) {
      await db
        .update(scheduledWorkouts)
        .set({ name: body.name })
        .where(
          and(
            eq(scheduledWorkouts.templateId, existing.templateId),
            eq(scheduledWorkouts.name, existing.name),
            sql`${scheduledWorkouts.date} >= NOW()`,
            ne(scheduledWorkouts.id, id),
          ),
        );
    }
  }

  const [updated] = await db
    .update(scheduledWorkouts)
    .set(update)
    .where(eq(scheduledWorkouts.id, id))
    .returning();

  // Calendar sync on date change
  if (update.date && (await isCalendarConnected(user.id))) {
    const calendarId = await getSelectedCalendarId(user.id);
    const newDate = update.date as Date;
    if (existing.calendarEventId) {
      const existingDateStr = existing.date.toISOString().split("T")[0];
      const newDateStr = newDate.toISOString().split("T")[0];
      if (existingDateStr !== newDateStr) {
        await updateCalendarEvent(
          user.id,
          existing.calendarEventId,
          newDate,
          calendarId,
          body.localDate,
        );
      }
    } else {
      const eventId = await createCalendarEvent(
        user.id,
        `${updated.name} (Scheduled)`,
        newDate,
        calendarId,
        body.localDate,
      );
      if (eventId) {
        await db
          .update(scheduledWorkouts)
          .set({ calendarEventId: eventId })
          .where(eq(scheduledWorkouts.id, id));
        updated.calendarEventId = eventId;
      }
    }
  }

  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownScheduled(id, user.id);

  if (existing.calendarEventId && (await isCalendarConnected(user.id))) {
    const calendarId = await getSelectedCalendarId(user.id);
    await deleteCalendarEvent(user.id, existing.calendarEventId, calendarId);
  }

  await db.delete(scheduledWorkouts).where(eq(scheduledWorkouts.id, id));
  return new Response(null, { status: 204 });
});
