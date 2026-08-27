import { NextRequest } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  routines,
  routineInstances,
  scheduledWorkouts,
  completedWorkouts,
  userSettings,
} from "@/lib/db/schema";
import { handle } from "@/lib/api/handler";
import { requireIntegrationCaller } from "@/lib/api/integration-auth";
import { buildSchedulePayload, type RawRows } from "@/lib/integration-schedule";
import { localDateKeyInZone, startOfLocalDayUtc } from "@/lib/date";

/**
 * GET /api/integrations/schedule
 *
 * Read-only view of the user's training schedule, for another system to render
 * (built 2026-08-25 for Liv, Ivo's assistant app).
 *
 * Auth is a shared secret bound to ONE user id server-side - see
 * lib/api/integration-auth.ts for why the caller cannot name the user.
 *
 * The route is listed in proxy.ts PUBLIC_PATHS because the session gate 307s
 * every unauthenticated /api request to /login, which would make this endpoint
 * unreachable no matter how correct its own auth was. "Public" there means only
 * "the cookie gate does not apply"; this route authenticates itself.
 *
 * GET ONLY. A shared secret sitting in another service's env is a weaker
 * credential than a real user session, so it must never be able to mutate.
 *
 * The response is a deliberately SHAPED projection (lib/integration-schedule),
 * not the raw rows - these tables have changed shape twice already and a
 * consumer must not be coupled to them.
 */
export const maxDuration = 30;

/** Upcoming window in days. Kept small so the payload stays predictable. */
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const UPCOMING_LIMIT = 7;
const RECENT_LIMIT = 3;

/**
 * FitYear stores NO timezone: `user_settings` has no such column and the app
 * derives the viewer's zone from a client-stamped cookie, which a machine
 * caller does not have. So the zone is a request parameter with a default, and
 * every entry also carries its raw UTC `at` so a consumer can re-derive if this
 * default is wrong for where Ivo actually is.
 */
const DEFAULT_TZ = "America/Los_Angeles";

function safeZone(tz: string | null): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export const GET = handle(async (request: NextRequest) => {
  const { userId } = requireIntegrationCaller(request);

  // An ABSENT param must fall through to the default. `Number(null)` is 0,
  // which is finite, so the previous check took the clamp branch and pinned the
  // window to a single day - the consumer was only ever seeing today and
  // tomorrow, and only got tomorrow because the boundary is inclusive.
  const daysParam = request.nextUrl.searchParams.get("days");
  const daysRaw = daysParam === null || daysParam.trim() === "" ? NaN : Number(daysParam);
  const days = Number.isFinite(daysRaw)
    ? Math.min(Math.max(Math.trunc(daysRaw), 1), MAX_DAYS)
    : DEFAULT_DAYS;

  // Zone precedence: an explicit ?tz= wins (a caller that knows better, or a
  // test), then the zone the DEVICE last reported, then the default. Liv should
  // send NO tz so Ivo's real phone zone is used - he travels, and assuming
  // California put "today" a day out whenever he is in Asia.
  const [settings] = await db
    .select({ timeZone: userSettings.timeZone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const timeZone = safeZone(
    request.nextUrl.searchParams.get("tz") ?? settings?.timeZone ?? null,
  );
  const now = new Date();
  // Window starts at the beginning of the LOCAL day, not at `now`. Filtering by
  // instant dropped the session due TODAY as soon as its start time passed:
  // Ivo's Day 1 sat at 14:00Z (07:00 in Los Angeles), so by 09:50 local it had
  // vanished and the consumer reported "nothing scheduled today" on the first
  // day of his program. A schedule is read by DAY.
  const windowStart = startOfLocalDayUtc(now, timeZone);
  const horizon = new Date(windowStart.getTime() + days * 24 * 60 * 60 * 1000);

  // The running program, if any. `status = 'active'` is the same filter the
  // Routines page uses; a cancelled or completed instance is history.
  const [instance] = await db
    .select()
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.userId, userId),
        eq(routineInstances.status, "active"),
      ),
    )
    .orderBy(desc(routineInstances.createdAt))
    .limit(1);

  // cycle_length lives on the routine, not the instance. routine_id is a plain
  // varchar with NO foreign key, so this can legitimately find nothing (there
  // is a live orphan instance in prod whose routine was deleted) - hence the
  // separate lookup and the null fallback rather than a join that drops rows.
  let cycleLength: number | null = null;
  if (instance) {
    const [routine] = await db
      .select({ cycleLength: routines.cycleLength })
      .from(routines)
      .where(and(eq(routines.id, instance.routineId), eq(routines.userId, userId)))
      .limit(1);
    cycleLength = routine?.cycleLength ?? null;
  }

  const scheduled = await db
    .select({
      id: scheduledWorkouts.id,
      name: scheduledWorkouts.name,
      date: scheduledWorkouts.date,
      exercises: scheduledWorkouts.exercises,
      routineInstanceId: scheduledWorkouts.routineInstanceId,
      routineDayIndex: scheduledWorkouts.routineDayIndex,
    })
    .from(scheduledWorkouts)
    .where(
      and(
        eq(scheduledWorkouts.userId, userId),
        gte(scheduledWorkouts.date, windowStart),
        // drizzle's own comparator, NOT a raw sql fragment: interpolating a JS
        // Date into raw sql reaches postgres.js unserialized and throws
        // ERR_INVALID_ARG_TYPE at query time.
        lte(scheduledWorkouts.date, horizon),
      ),
    )
    .orderBy(scheduledWorkouts.date);

  const completed = await db
    .select({
      name: completedWorkouts.name,
      completedAt: completedWorkouts.completedAt,
    })
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, userId))
    .orderBy(desc(completedWorkouts.completedAt))
    .limit(RECENT_LIMIT);

  const rows: RawRows = {
    instance: instance
      ? {
          routineName: instance.routineName,
          startDate: instance.startDate,
          endDate: instance.endDate,
          durationDays: instance.durationDays,
          totalWorkouts: instance.totalWorkouts,
          completedWorkouts: instance.completedWorkouts,
          skippedWorkouts: instance.skippedWorkouts,
        }
      : null,
    cycleLength,
    scheduled,
    completed,
  };

  const payload = buildSchedulePayload(rows, {
    now,
    windowStart,
    // Inclusive last day of the window. `horizon` is the exclusive instant the
    // query stops at, so step back a moment to land on the final local day.
    windowEnd: new Date(horizon.getTime() - 1),
    timeZone,
    dateKey: localDateKeyInZone,
    upcomingLimit: UPCOMING_LIMIT,
    recentLimit: RECENT_LIMIT,
    // Exercise detail is OPT-IN: the default payload carries counts only, which
    // is what the consumer asked for and sidesteps the expired-image-URL and
    // lbs-conversion problems entirely.
    includeExercises: request.nextUrl.searchParams.get("detail") === "full",
  });

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
      // Never let a CDN or browser hold a copy of one user's training data.
      "cache-control": "no-store, private",
    },
  });
});
