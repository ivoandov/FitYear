import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { scheduledWorkouts, userSettings } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  createCalendarEvent,
  isCalendarConnected,
} from "@/lib/calendar";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.userId, user.id));
  return rows;
  // NOTE: original Replit route has an "auto-reschedule" pass that creates
  // missing scheduled rows when an active routine instance has remaining
  // workouts but no scheduled entries. Deferred to Phase 5b — not blocking
  // the migration since users still see their existing scheduled workouts.
});

const PostSchema = z.object({
  name: z.string().min(1),
  date: z.string().optional(),
  localDate: z.string().optional(),
  exercises: z.unknown(),
  templateId: z.string().nullable().optional(),
  routineInstanceId: z.string().nullable().optional(),
  routineDayIndex: z.number().int().nullable().optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  // Use localDate (YYYY-MM-DD) at noon UTC for timezone-safe storage
  const dateValue = body.localDate
    ? new Date(`${body.localDate}T12:00:00Z`)
    : body.date
      ? new Date(body.date)
      : new Date();

  const [created] = await db
    .insert(scheduledWorkouts)
    .values({
      userId: user.id,
      name: body.name,
      date: dateValue,
      exercises: body.exercises,
      templateId: body.templateId ?? null,
      routineInstanceId: body.routineInstanceId ?? null,
      routineDayIndex: body.routineDayIndex ?? null,
    })
    .returning();

  // Sync to Google Calendar if connected
  if (await isCalendarConnected(user.id)) {
    const [settings] = await db
      .select({ calendarId: userSettings.selectedCalendarId })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    const eventId = await createCalendarEvent(
      user.id,
      `${body.name} (Scheduled)`,
      dateValue,
      settings?.calendarId ?? undefined,
      body.localDate,
    );
    if (eventId) {
      await db
        .update(scheduledWorkouts)
        .set({ calendarEventId: eventId })
        .where(eq(scheduledWorkouts.id, created.id));
      created.calendarEventId = eventId;
    }
  }

  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
