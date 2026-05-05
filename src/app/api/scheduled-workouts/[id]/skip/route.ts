import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  scheduledWorkouts,
  routineInstances,
  userSettings,
} from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { deleteCalendarEvent, isCalendarConnected } from "@/lib/calendar";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const [existing] = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.id, id))
    .limit(1);

  if (!existing) throw new ApiError(404, "Workout not found");
  if (existing.userId !== user.id) throw new ApiError(403, "Access denied");
  if (!existing.routineInstanceId) {
    throw new ApiError(400, "Only routine workouts can be skipped");
  }

  if (existing.calendarEventId && (await isCalendarConnected(user.id))) {
    const [s] = await db
      .select({ id: userSettings.selectedCalendarId })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    await deleteCalendarEvent(user.id, existing.calendarEventId, s?.id ?? undefined);
  }

  await db
    .update(routineInstances)
    .set({ skippedWorkouts: sql`${routineInstances.skippedWorkouts} + 1` })
    .where(eq(routineInstances.id, existing.routineInstanceId));

  await db.delete(scheduledWorkouts).where(eq(scheduledWorkouts.id, id));

  return { success: true, message: "Workout skipped" };
});
