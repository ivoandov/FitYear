import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { completedWorkouts, userSettings } from "@/lib/db/schema";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { createCalendarEvent, isCalendarConnected } from "@/lib/calendar";
import { localDateKey } from "@/lib/date";

// Iterates all completed workouts; per-workout calendar API calls add up.
// Bumping past Hobby's default 10s; ~1 event per ~300ms keeps us well under 60s
// for a typical user but cap is here as a safety net.
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
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, user.id));

  let created = 0;
  let alreadySynced = 0;
  let failed = 0;
  const workouts: SyncedWorkout[] = [];

  for (const w of rows) {
    const date = w.completedAt instanceof Date ? w.completedAt : new Date(w.completedAt);
    const dateStr = localDateString(date);

    if (w.calendarEventId) {
      alreadySynced++;
      workouts.push({ name: w.name, date: dateStr, status: "already_synced", eventId: w.calendarEventId });
      continue;
    }

    try {
      const eventId = await createCalendarEvent(
        user.id,
        w.name,
        date,
        selectedCalendarId ?? undefined,
        dateStr,
      );
      if (eventId) {
        await db
          .update(completedWorkouts)
          .set({ calendarEventId: eventId })
          .where(eq(completedWorkouts.id, w.id));
        created++;
        workouts.push({ name: w.name, date: dateStr, status: "created", eventId });
      } else {
        failed++;
        workouts.push({ name: w.name, date: dateStr, status: "failed" });
      }
    } catch (e) {
      console.error(`[sync-completed] ${w.id} failed:`, (e as Error).message);
      failed++;
      workouts.push({ name: w.name, date: dateStr, status: "failed" });
    }
  }

  return {
    success: true,
    created,
    alreadySynced,
    failed,
    total: rows.length,
    workouts,
  };
});
