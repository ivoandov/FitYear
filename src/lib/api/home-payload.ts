import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/lib/db";
import { scheduledDateKey, localDateKeyInZone } from "@/lib/date";
import { hasRunOutOfDays } from "@/lib/routine-completion";
import { viewerTimeZone } from "@/lib/server-timezone";
import {
  routineInstances,
  scheduledWorkouts,
  userSettings,
  workoutTemplates,
} from "@/lib/db/schema";

/**
 * The reads Home needs before it can paint anything.
 *
 * WHY THIS EXISTS. Measured against production, Home's first paint was 2.6
 * seconds. Time to first byte was 20ms - the HTML was never the problem. The
 * cost was a dozen client API calls fired at once, each landing on its own cold
 * function instance and taking 1.3 to 3.3 seconds. Loading them on the server
 * instead makes it ONE invocation, running these queries in parallel next to
 * the database, with the data arriving in the same response as the HTML.
 *
 * WHY THE ROUTES CALL THESE TOO. Each function below is the single
 * implementation of its endpoint's GET. If the server-rendered payload and the
 * live endpoint were written separately they would drift, and the failure would
 * be invisible: Home would paint one thing and then silently replace it with
 * another on the first refetch.
 *
 * Every function takes the userId from the SESSION, never from a caller's
 * argument, in the same sense the routes do - none of these is reachable except
 * through `requireUser`.
 */

export function loadScheduledWorkouts(userId: string) {
  return db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.userId, userId));
}

export function loadWorkoutTemplates(userId: string) {
  return db
    .select()
    .from(workoutTemplates)
    .where(eq(workoutTemplates.userId, userId));
}

export function loadRoutineInstances(userId: string) {
  return db
    .select()
    .from(routineInstances)
    .where(eq(routineInstances.userId, userId));
}

/**
 * The programs actually running, which is not the same as the rows marked
 * active.
 *
 * A program also ends by being abandoned: its last planned day passes and
 * nothing is left on the calendar, so no future session can arrive to finish
 * the count. Nothing used to notice, so a block that ended weeks ago still
 * presented itself as the current one on Home, in the Routines card and to
 * FitBot - and restarting that same routine answered 409.
 *
 * Retiring it is a WRITE, so it happens in `after()`: the caller is Home's
 * first paint, and this must not add a round trip to it. The row is left out of
 * the answer immediately either way, so the screen is right on this render
 * rather than the next one.
 */
export async function loadActiveRoutineInstances(userId: string) {
  const rows = await db
    .select({
      instance: routineInstances,
      // One statement rather than a second query per instance: Home pays for
      // this on every paint.
      //
      // Table names are written out rather than interpolated as Drizzle column
      // refs. Inside a raw correlated subquery Drizzle emits them UNQUALIFIED,
      // so `${scheduledWorkouts.routineInstanceId} = ${routineInstances.id}`
      // became `"routine_instance_id" = "id"` - both resolved to the INNER
      // table, the condition was never true, and every program read as having
      // nothing scheduled. It typechecks, builds, and silently counts zero.
      upcoming: sql<number>`(
        select count(*) from scheduled_workouts sw
        where sw.routine_instance_id = routine_instances.id
          and sw.user_id = routine_instances.user_id
          and sw.date >= current_date
      )`.as("upcoming"),
    })
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.userId, userId),
        eq(routineInstances.status, "active"),
      ),
    );

  const todayKey = localDateKeyInZone(new Date(), await viewerTimeZone());
  const finished = rows.filter((r) =>
    hasRunOutOfDays({
      endDateKey: r.instance.endDate ? scheduledDateKey(r.instance.endDate) : null,
      todayKey,
      upcomingSessions: Number(r.upcoming ?? 0),
    }),
  );

  if (finished.length > 0) {
    after(async () => {
      for (const r of finished) {
        await db
          .update(routineInstances)
          .set({ status: "completed" })
          .where(
            and(
              eq(routineInstances.id, r.instance.id),
              eq(routineInstances.userId, userId),
              eq(routineInstances.status, "active"),
            ),
          );
      }
    });
  }

  const done = new Set(finished.map((r) => r.instance.id));
  return rows.filter((r) => !done.has(r.instance.id)).map((r) => r.instance);
}

/**
 * Settings, with the same defaults the endpoint returns for a user who has no
 * row yet. There is no trigger creating these rows, so "no row" is an ordinary
 * state for a new account rather than an error.
 */
export async function loadUserSettings(userId: string) {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return (
    row ?? {
      userId,
      selectedCalendarId: null,
      selectedCalendarName: null,
      weightUnit: "lbs",
      monthlyWorkoutGoal: 16,
      fitbotDefaultFocus: "strength",
      hasCompletedOnboarding: false,
      onboardingDaysPerWeek: null,
      onboardingProgramLength: null,
    }
  );
}

export type HomePayload = {
  scheduledWorkouts: Awaited<ReturnType<typeof loadScheduledWorkouts>>;
  workoutTemplates: Awaited<ReturnType<typeof loadWorkoutTemplates>>;
  routineInstances: Awaited<ReturnType<typeof loadRoutineInstances>>;
  activeRoutineInstances: Awaited<ReturnType<typeof loadActiveRoutineInstances>>;
  userSettings: Awaited<ReturnType<typeof loadUserSettings>>;
};

/** All of it, in parallel, in one round trip from the client's point of view. */
export async function loadHomePayload(userId: string): Promise<HomePayload> {
  const [
    scheduled,
    templates,
    instances,
    activeInstances,
    settings,
  ] = await Promise.all([
    loadScheduledWorkouts(userId),
    loadWorkoutTemplates(userId),
    loadRoutineInstances(userId),
    loadActiveRoutineInstances(userId),
    loadUserSettings(userId),
  ]);
  return {
    scheduledWorkouts: scheduled,
    workoutTemplates: templates,
    routineInstances: instances,
    activeRoutineInstances: activeInstances,
    userSettings: settings,
  };
}
