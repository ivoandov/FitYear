import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
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

export function loadActiveRoutineInstances(userId: string) {
  return db
    .select()
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.userId, userId),
        eq(routineInstances.status, "active"),
      ),
    );
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
