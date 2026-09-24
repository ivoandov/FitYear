import { z } from "zod";

/**
 * A program another system hands FitYear, checked before anything is written.
 *
 * Built 2026-09-23 for Liv, Ivo's assistant. His complaint, verbatim: "things are
 * fragmented across apps/agents." Liv holds his health record and knows what he
 * has actually trained; FitYear holds the routines and the calendar; and until
 * now the only way from one to the other was a person pasting text. This module
 * is the shape of what may cross that seam.
 *
 * It is PURE: no database, no clock. The route hands it today's date key and the
 * raw body, and gets back either a request it may act on or one sentence saying
 * why not. The refusals are the point and are tested first.
 *
 * ## What it refuses
 *
 *   A DAY THAT APPEARS TWICE. dayIndex is a position in the rotation, and two
 *   entries at one position would be silently merged or silently dropped by the
 *   scheduler; neither is what anybody meant.
 *
 *   A START IN THE PAST. A program that starts yesterday has already missed a
 *   session before it exists.
 *
 *   A DATE THAT IS NOT A DAY. "2026-02-31" matches the pattern and is not a date;
 *   `Date.parse` would quietly roll it into March.
 *
 *   ANYTHING UNBOUNDED. Every string and every count has a ceiling, because this
 *   arrives from another service's model and a routine with 400 exercises on one
 *   day is a bug wherever it came from.
 *
 * ## What it deliberately does NOT do
 *
 * It does not reconcile exercise names against the catalog and it does not
 * decide whether a program is already running. Both need the database, and both
 * are the route's job, using the same functions the app's own buttons use.
 */

export const MAX_DAY_INDEX = 14;
export const MAX_EXERCISES_PER_DAY = 20;
export const MAX_NAME = 80;
export const MAX_NOTE = 400;
export const MAX_PROGRAM_DAYS = 366;
export const MAX_DOCUMENT = 40_000;

const ExerciseSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  sets: z.number().int().min(1).max(10),
  /** Free text, never a number: "6-8", "AMRAP", "30s". Shown verbatim by the tracker. */
  reps: z.string().trim().min(1).max(24),
  /** Seconds. */
  rest: z.number().int().min(0).max(900).optional(),
  notes: z.string().trim().max(200).optional(),
  /** The STARTING working weight in pounds; progression climbs from here. */
  targetLoadLbs: z.number().min(0).max(2000).optional(),
});

const DaySchema = z.object({
  dayIndex: z.number().int().min(1).max(MAX_DAY_INDEX),
  workoutName: z.string().trim().min(1).max(MAX_NAME),
  exercises: z.array(ExerciseSchema).min(1).max(MAX_EXERCISES_PER_DAY),
});

const ProgressionSchema = z
  .object({
    incrementLbs: z.number().min(0).max(100),
    everyWeeks: z.number().int().min(1).max(12),
  })
  .nullable();

const RoutineSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME),
  description: z.string().trim().max(500).optional(),
  days: z.array(DaySchema).min(1).max(MAX_DAY_INDEX),
  progression: ProgressionSchema.optional(),
});

const StartSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  durationDays: z.number().int().min(1).max(MAX_PROGRAM_DAYS),
});

const DocumentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().min(1).max(MAX_DOCUMENT),
});

export const ProgramRequestSchema = z.object({
  /** Validate and reconcile, write nothing, return the plan. */
  dryRun: z.boolean().optional(),
  /** End the program currently running before starting this one. Refused otherwise. */
  endActive: z.boolean().optional(),
  routine: RoutineSchema,
  start: StartSchema,
  /** A source kept whole for the coach (his constraints file), replaced by title. */
  document: DocumentSchema.optional(),
  /** One short fact for the coach's memory, deduplicated by the note writer. */
  note: z.string().trim().min(1).max(MAX_NOTE).optional(),
});

export type ProgramRequest = z.infer<typeof ProgramRequestSchema>;
export type ProgramDay = ProgramRequest["routine"]["days"][number];

export type ParsedProgram = { ok: true; request: ProgramRequest } | { ok: false; why: string };

/** Is this string a real calendar day? The pattern alone lets February 31st through. */
export function isCalendarDay(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseProgramRequest(raw: unknown, todayKey: string): ParsedProgram {
  const parsed = ProgramRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "(body)";
    return { ok: false, why: `${where}: ${first?.message ?? "invalid"}` };
  }
  const request = parsed.data;

  const seen = new Set<number>();
  for (const day of request.routine.days) {
    if (seen.has(day.dayIndex)) {
      return { ok: false, why: `dayIndex ${day.dayIndex} appears twice` };
    }
    seen.add(day.dayIndex);
  }

  if (!isCalendarDay(request.start.startDate)) {
    return { ok: false, why: `startDate ${request.start.startDate} is not a calendar day` };
  }
  if (request.start.startDate < todayKey) {
    return {
      ok: false,
      why: `startDate ${request.start.startDate} is before today (${todayKey})`,
    };
  }
  return { ok: true, request };
}

/**
 * The rotation period the Routines card and the scheduler read.
 *
 * A routine whose days all sit inside one week rotates weekly, which is what a
 * 4-day split with rest gaps means; anything reaching into a second week is a
 * two-week rotation. Written rather than left null because the start route
 * repeats the cycle across the duration off this number.
 */
export function cycleLengthFor(days: readonly { dayIndex: number }[]): number {
  const max = Math.max(...days.map((d) => d.dayIndex));
  return max <= 7 ? 7 : 14;
}

export interface RoutineEntryInput {
  dayIndex: number;
  workoutName: string;
  workoutTemplateId: null;
  exercises: Array<{
    name: string;
    sets: number;
    reps: string;
    rest?: number;
    notes?: string;
    targetLoadLbs?: number;
  }>;
}

/**
 * The routine's days as `routine_entries` rows, in rotation order, names passed
 * through the caller's reconciler so a program reuses the catalog's own spelling.
 *
 * Optional fields are OMITTED rather than written as null, matching the shape
 * FitBot's own program builder stores, so the tracker's readers see one shape.
 */
export function entriesFor(
  days: readonly ProgramDay[],
  reconcile: (name: string) => string,
): RoutineEntryInput[] {
  return [...days]
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map((d) => ({
      dayIndex: d.dayIndex,
      workoutName: d.workoutName,
      workoutTemplateId: null,
      exercises: d.exercises.map((e) => ({
        name: reconcile(e.name),
        sets: e.sets,
        reps: e.reps,
        ...(e.rest !== undefined ? { rest: e.rest } : {}),
        ...(e.notes ? { notes: e.notes } : {}),
        ...(e.targetLoadLbs !== undefined ? { targetLoadLbs: e.targetLoadLbs } : {}),
      })),
    }));
}
