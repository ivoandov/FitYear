import { z } from "zod";
import { EXERCISE_TYPES, normalizeExerciseType } from "@/lib/exercise-types";

/**
 * Shape of a workout or program imported from somewhere else - a plain-text
 * plan, a rich-text paste, a JSON export from another app, or something an LLM
 * wrote. The model normalizes whatever arrives into this; the commit route then
 * reconciles the exercise names against the catalog and writes the rows.
 *
 * Tolerant in the same way and for the same reason as lib/program-schema: the
 * parse costs a metered AI call, so a field the model spelled slightly
 * differently must not throw the whole import away. See the note there.
 */

const exerciseTypeField = z.preprocess(normalizeExerciseType, z.enum(EXERCISE_TYPES));

/** Reps is a prescription string ("5", "8-12", "AMRAP", "30s"). */
const repsField = z.preprocess(
  (v) => {
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string") return v;
    return "";
  },
  z.string().max(40),
);

const intField = (fallback: number, min: number, max: number) =>
  z.preprocess((v) => {
    const n =
      typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.round(n), min), max);
  }, z.number().int().min(min).max(max));

export const ImportedExerciseSchema = z.object({
  name: z.string().min(1).max(60),
  muscleGroups: z.array(z.string().max(40)).max(10).default([]),
  exerciseType: exerciseTypeField,
  sets: intField(3, 1, 20),
  reps: repsField,
  rest: intField(90, 0, 3600),
  notes: z.string().max(300).default(""),
});

export const ImportedDaySchema = z.object({
  /** 1-indexed day within the program. */
  dayIndex: intField(1, 1, 400),
  workoutName: z.string().min(1).max(80),
  isRest: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
  exercises: z.array(ImportedExerciseSchema).max(40).default([]),
});

/**
 * A single session. `kind` is what tells the commit route whether to write a
 * workout template or a whole routine.
 */
export const ImportedWorkoutSchema = z.object({
  kind: z.literal("workout"),
  name: z.string().min(1).max(80),
  exercises: z.array(ImportedExerciseSchema).min(1).max(40),
});

/** A multi-day program. Rest days are included so the rotation is visible. */
export const ImportedRoutineSchema = z.object({
  kind: z.literal("routine"),
  name: z.string().min(1).max(80),
  /** Days in one rotation, including rest slots. */
  cycleLength: intField(7, 1, 60),
  days: z.array(ImportedDaySchema).min(1).max(400),
});

export const ImportedPlanSchema = z.discriminatedUnion("kind", [
  ImportedWorkoutSchema,
  ImportedRoutineSchema,
]);

export type ImportedExercise = z.infer<typeof ImportedExerciseSchema>;
export type ImportedDay = z.infer<typeof ImportedDaySchema>;
export type ImportedWorkout = z.infer<typeof ImportedWorkoutSchema>;
export type ImportedRoutine = z.infer<typeof ImportedRoutineSchema>;
export type ImportedPlan = z.infer<typeof ImportedPlanSchema>;

/** How each imported exercise name was resolved against the catalog. */
export interface ResolvedExerciseReport {
  /** The name as it appeared in the import. */
  imported: string;
  /** The catalog name it will actually use. */
  resolved: string;
  /** Whether an existing exercise was reused or a new one was created. */
  action: "matched" | "created";
  exerciseId: string;
}

/** Everything the import UI needs to show what it is about to do. */
export interface ImportPreview {
  plan: ImportedPlan;
  /** Distinct exercise names in the plan, in first-appearance order. */
  exerciseNames: string[];
}

/**
 * Distinct exercise names across a plan, in the order they first appear.
 * Used for the preview and to drive reconciliation once, not per occurrence.
 */
export function planExerciseNames(plan: ImportedPlan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(name.trim());
  };
  if (plan.kind === "workout") {
    for (const ex of plan.exercises) add(ex.name);
  } else {
    for (const day of plan.days) for (const ex of day.exercises) add(ex.name);
  }
  return out;
}

/** Total training days in a plan (rest days excluded). */
export function planTrainingDayCount(plan: ImportedPlan): number {
  return plan.kind === "workout" ? 1 : plan.days.filter((d) => !d.isRest).length;
}

/**
 * Repeat a plan's day pattern until it fills `durationDays`.
 *
 * An imported plan is usually ONE cycle - a week of training - but a program
 * runs for 30 or 60 days. Without this the routine ends after the imported
 * week, which is what Ivo hit: he imported a week and could only get a 7-day
 * routine out of it.
 *
 * Repeats by CYCLE LENGTH, not by array position, so rest days keep their place
 * in the rotation. Day indices stay absolute (1..durationDays), which is the
 * contract routine_entries and the routine-start route both expect.
 *
 * Returns the days unchanged when the plan already covers the duration, so
 * importing a genuine 30-day program is never re-tiled.
 */
export function repeatPlanDays(
  days: ImportedDay[],
  cycleLength: number,
  durationDays: number,
): ImportedDay[] {
  const period = Math.max(1, Math.floor(cycleLength) || 1);
  if (!Number.isFinite(durationDays) || durationDays <= 0) return days;

  const covered = days.reduce((max, d) => Math.max(max, d.dayIndex), 0);
  if (covered >= durationDays) return days;

  // Position within the cycle -> the day that occupies it.
  const bySlot = new Map<number, ImportedDay>();
  for (const d of days) {
    const slot = ((d.dayIndex - 1) % period + period) % period;
    if (!bySlot.has(slot)) bySlot.set(slot, d);
  }

  const out: ImportedDay[] = [];
  for (let dayIndex = 1; dayIndex <= durationDays; dayIndex++) {
    const slot = ((dayIndex - 1) % period + period) % period;
    const source = bySlot.get(slot);
    if (!source) {
      // A slot the plan never filled is rest, not a gap to silently drop.
      out.push({ dayIndex, workoutName: "Rest", isRest: true, exercises: [] });
      continue;
    }
    out.push({ ...source, dayIndex });
  }
  return out;
}
