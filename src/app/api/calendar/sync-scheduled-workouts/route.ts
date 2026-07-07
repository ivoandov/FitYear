import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduledWorkouts, userSettings } from "@/lib/db/schema";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  checkCalendarEventExists,
  createCalendarEvent,
  isCalendarConnected,
} from "@/lib/calendar";
import { localDateKey } from "@/lib/date";

export const maxDuration = 60;

type SyncedWorkout = {
  name: string;
  date: string;
  status: "created" | "already_synced" | "failed";
  eventId?: string;
};

function localDateString(d: Date): string {
  return localDateKey(d);
}

export const POST = handle(async () => {
  const { user } = await requireUser();

  if (!(await isCalendarConnected(user.id))) {
    throw new ApiError(400, "Google Calendar not connected");
  }

  const [settings] = await db
    .select({ calendarId: userSettings.selectedCalendarId })
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);
  const selectedCalendarId = settings?.calendarId ?? undefined;

  const rows = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.userId, user.id));

  let created = 0;
  let alreadySynced = 0;
  let failed = 0;
  const workouts: SyncedWorkout[] = [];

  for (const w of rows) {
    const date = w.date instanceof Date ? w.date : new Date(w.date);
    const dateStr = localDateString(date);

    if (w.calendarEventId) {
      // Verify the event still exists; if not, fall through to recreate it.
      let exists = await checkCalendarEventExists(
        user.id,
        w.calendarEventId,
        selectedCalendarId,
      );
      // Fallback: event may have been created in primary before user picked
      // a different calendar. Check primary as a secondary lookup.
      if (!exists && selectedCalendarId && selectedCalendarId !== "primary") {
        exists = await checkCalendarEventExists(user.id, w.calendarEventId, "primary");
      }

      if (exists) {
        alreadySynced++;
        workouts.push({ name: w.name, date: dateStr, status: "already_synced", eventId: w.calendarEventId });
        continue;
      }
      // Stale event id — clear and recreate below.
      await db
        .update(scheduledWorkouts)
        .set({ calendarEventId: null })
        .where(eq(scheduledWorkouts.id, w.id));
    }

    try {
      const eventId = await createCalendarEvent(
        user.id,
        `${w.name} (Scheduled)`,
        date,
        selectedCalendarId ?? undefined,
        dateStr,
      );
      if (eventId) {
        await db
          .update(scheduledWorkouts)
          .set({ calendarEventId: eventId })
          .where(eq(scheduledWorkouts.id, w.id));
        created++;
        workouts.push({ name: w.name, date: dateStr, status: "created", eventId });
      } else {
        failed++;
        workouts.push({ name: w.name, date: dateStr, status: "failed" });
      }
    } catch (e) {
      console.error(`[sync-scheduled] ${w.id} failed:`, (e as Error).message);
      failed++;
      workouts.push({ name: w.name, date: dateStr, status: "failed" });
    }
  }

  return {
    success: true,
    message: "Calendar sync complete",
    created,
    alreadySynced,
    failed,
    total: rows.length,
    workouts,
  };
});
