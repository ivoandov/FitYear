import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { completedWorkouts, userSettings } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { createCalendarEvent, isCalendarConnected } from "@/lib/calendar";

type Ctx = { params: Promise<{ id: string }> };

const Body = z
  .object({
    localDate: z.string().optional(),
  })
  .optional();

export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = Body.parse(await request.json().catch(() => ({})));

  const [workout] = await db
    .select()
    .from(completedWorkouts)
    .where(eq(completedWorkouts.id, id))
    .limit(1);
  if (!workout) throw new ApiError(404, "Workout not found");
  if (workout.userId !== user.id) throw new ApiError(403, "Access denied");

  if (!(await isCalendarConnected(user.id))) {
    throw new ApiError(
      400,
      "Calendar not connected. Please connect your Google Calendar in Settings.",
    );
  }

  const [s] = await db
    .select({ calendarId: userSettings.selectedCalendarId })
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);
  const selectedCalendarId = s?.calendarId ?? undefined;

  const date = workout.completedAt instanceof Date
    ? workout.completedAt
    : new Date(workout.completedAt);
  const localDateStr =
    body?.localDate ??
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const eventId = await createCalendarEvent(
    user.id,
    workout.name,
    date,
    selectedCalendarId,
    localDateStr,
  );
  if (!eventId) {
    throw new ApiError(500, "Calendar sync failed - no event ID returned");
  }

  await db
    .update(completedWorkouts)
    .set({ calendarEventId: eventId })
    .where(eq(completedWorkouts.id, id));

  return { success: true, calendarEventId: eventId };
});
