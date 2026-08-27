/**
 * The read-only projection FitYear exposes to other systems (built 2026-08-25
 * for Liv, Ivo's personal-assistant app at liv.flyhi.ai).
 *
 * This is a DELIBERATE ANTI-CORRUPTION LAYER, not a dump of the tables. These
 * schemas have moved a lot - weekday-pinned programs became rotating cycles,
 * and the per-set data went from a jsonb blob to normalized tables - so any
 * consumer reading the raw rows would be coupled to internals that keep
 * changing. Everything here is shaped, named for the reader, and safe to keep
 * stable even when the storage underneath moves again.
 *
 * Pure on purpose: the route fetches, this shapes, the tests cover the shaping.
 */

/** Fields we are willing to publish for an exercise. Everything else is dropped. */
export interface PublicExercise {
  name: string;
  muscleGroups: string[];
  sets: number | null;
  reps: string | null;
  restSeconds: number | null;
}

export interface PublicUpcoming {
  /** Local calendar day in the requested zone, YYYY-MM-DD. */
  date: string;
  /** The same instant in UTC, so a consumer can re-derive if the zone is wrong. */
  at: string;
  name: string;
  exercise_count: number;
  is_today: boolean;
  /** "routine" when it came from a running program, "manual" when hand-scheduled. */
  source: "routine" | "manual";
  /** Absolute day within the program, or null for a hand-scheduled session. */
  day_index: number | null;
  /** Only present when the caller asks for detail. */
  exercises?: PublicExercise[];
}

export interface PublicActive {
  routine_name: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  completed_workouts: number;
  skipped_workouts: number;
  total_workouts: number;
  /** Days in one rotation for a cycle program; null for manual/legacy. */
  cycle_length: number | null;
}

export interface PublicRecent {
  date: string;
  at: string;
  name: string;
}

export interface SchedulePayload {
  as_of: string;
  /** The zone every `date` above was resolved in. */
  timezone: string;
  /**
   * The local-day window `upcoming` actually describes, inclusive.
   *
   * Without it a consumer cannot tell a genuine REST DAY from a hole in the
   * feed: both look like "no session dated today". With it, a date inside the
   * window and absent from `upcoming` is definitively a rest day.
   */
  covers: { from: string; to: string };
  /** null when no routine instance is running. NEVER omitted. */
  active: PublicActive | null;
  /** Today onward. Always an array, never absent. */
  upcoming: PublicUpcoming[];
  /** Most recent completed sessions. Always an array, never absent. */
  recent: PublicRecent[];
}

/** Rows as they come out of the DB, loosely typed since jsonb is unstructured. */
export interface RawRows {
  instance: {
    routineName: string;
    startDate: Date | string;
    endDate: Date | string;
    durationDays: number;
    totalWorkouts: number;
    completedWorkouts: number;
    skippedWorkouts: number;
  } | null;
  cycleLength: number | null;
  scheduled: Array<{
    name: string;
    date: Date | string;
    exercises: unknown;
    routineInstanceId: string | null;
    routineDayIndex: number | null;
  }>;
  completed: Array<{ name: string; completedAt: Date | string }>;
}

function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Pick only the publishable fields off a stored exercise object.
 *
 * The drops matter as much as the keeps. `imageUrl` is excluded because some
 * legacy rows still carry Replit-era SIGNED GCS URLs that expired in January
 * 2026 - publishing those would hand a consumer dead links plus our bucket and
 * service-account internals. `description` is excluded as bloat, and `id`
 * because a consumer must not start joining on FitYear's internal ids.
 */
export function toPublicExercise(raw: Record<string, unknown>): PublicExercise {
  const muscles = Array.isArray(raw.muscleGroups)
    ? (raw.muscleGroups as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    muscleGroups: muscles,
    sets: num(raw.sets),
    reps: typeof raw.reps === "string" ? raw.reps : num(raw.reps) === null ? null : String(raw.reps),
    restSeconds: num(raw.rest) ?? num(raw.restSeconds),
  };
}

/** Cap so one absurd row cannot make the payload unbounded. */
export const MAX_EXERCISES_PER_WORKOUT = 40;

export interface BuildOptions {
  now: Date;
  /** Local day the window opens on (inclusive). */
  windowStart: Date;
  /** Local day the window closes on (inclusive). */
  windowEnd: Date;
  /** IANA zone every date is resolved in. */
  timeZone: string;
  /**
   * Resolves an INSTANT to a YYYY-MM-DD key in `timeZone`. For things that
   * happened at a moment: "now", a completed workout.
   */
  dateKey: (d: Date | string, tz: string) => string;
  /**
   * Recovers the authored day from a stored SCHEDULED date. Zone-free, because
   * a day someone chose is the same day everywhere. Using `dateKey` here reads
   * one day late from UTC+12 east.
   */
  scheduledKey: (d: Date | string) => string;
  upcomingLimit: number;
  recentLimit: number;
  includeExercises: boolean;
}

export function buildSchedulePayload(rows: RawRows, opts: BuildOptions): SchedulePayload {
  const { now, windowStart, windowEnd, timeZone, dateKey, scheduledKey, upcomingLimit, recentLimit, includeExercises } = opts;
  const todayKey = dateKey(now, timeZone);

  const active: PublicActive | null = rows.instance
    ? {
        routine_name: rows.instance.routineName,
        start_date: scheduledKey(rows.instance.startDate),
        end_date: scheduledKey(rows.instance.endDate),
        duration_days: rows.instance.durationDays,
        completed_workouts: rows.instance.completedWorkouts,
        skipped_workouts: rows.instance.skippedWorkouts,
        total_workouts: rows.instance.totalWorkouts,
        cycle_length: rows.cycleLength,
      }
    : null;

  const upcoming: PublicUpcoming[] = rows.scheduled.slice(0, upcomingLimit).map((s) => {
    const all = asArray(s.exercises);
    const item: PublicUpcoming = {
      date: scheduledKey(s.date),
      at: iso(s.date),
      name: s.name,
      exercise_count: all.length,
      is_today: scheduledKey(s.date) === todayKey,
      source: s.routineInstanceId ? "routine" : "manual",
      day_index: s.routineDayIndex ?? null,
    };
    if (includeExercises) {
      item.exercises = all.slice(0, MAX_EXERCISES_PER_WORKOUT).map(toPublicExercise);
    }
    return item;
  });

  return {
    as_of: now.toISOString(),
    timezone: timeZone,
    covers: { from: dateKey(windowStart, timeZone), to: dateKey(windowEnd, timeZone) },
    active,
    upcoming,
    recent: rows.completed.slice(0, recentLimit).map((c) => ({
      date: dateKey(c.completedAt, timeZone),
      at: iso(c.completedAt),
      name: c.name,
    })),
  };
}
