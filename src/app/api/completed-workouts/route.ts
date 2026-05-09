import { NextRequest } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  scheduledWorkouts,
  routineInstances,
  userSettings,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  isCalendarConnected,
} from "@/lib/calendar";

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

  // Stage 1: parallel reads — scheduled workout (for templateId/routineInstance/
  // stale calendar event), calendar-connected check, and selected calendar id.
  const [scheduledWorkoutRow, calendarConnected, settings] = await Promise.all([
    body.scheduledWorkoutId
      ? db
          .select()
          .from(scheduledWorkouts)
          .where(eq(scheduledWorkouts.id, body.scheduledWorkoutId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    isCalendarConnected(user.id),
    db
      .select({ calendarId: userSettings.selectedCalendarId })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const templateId = body.templateId ?? scheduledWorkoutRow?.templateId ?? null;
  const scheduledRoutineInstanceId =
    scheduledWorkoutRow?.routineInstanceId ?? null;

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

  // Stage 2: parallel side effects after the insert succeeds.
  //   - Routine progress increment
  //   - Stale "(Scheduled)" event deletion
  //   - New completed event creation (then a tiny update with the event id)
  const sideEffects: Promise<unknown>[] = [];

  if (scheduledRoutineInstanceId) {
    sideEffects.push(
      db
        .update(routineInstances)
        .set({
          completedWorkouts: sql`${routineInstances.completedWorkouts} + 1`,
        })
        .where(eq(routineInstances.id, scheduledRoutineInstanceId)),
    );
  }

  if (calendarConnected) {
    if (scheduledWorkoutRow?.calendarEventId) {
      sideEffects.push(
        deleteCalendarEvent(
          user.id,
          scheduledWorkoutRow.calendarEventId,
          settings?.calendarId ?? undefined,
        ),
      );
    }

    sideEffects.push(
      (async () => {
        const eventId = await createCalendarEvent(
          user.id,
          body.name,
          created.completedAt,
          settings?.calendarId ?? undefined,
          body.localDate,
        );
        if (eventId) {
          await db
            .update(completedWorkouts)
            .set({ calendarEventId: eventId })
            .where(eq(completedWorkouts.id, created.id));
          created.calendarEventId = eventId;
        }
      })(),
    );
  }

  await Promise.all(sideEffects);

  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
