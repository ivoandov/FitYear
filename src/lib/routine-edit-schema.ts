import { z } from "zod";

/**
 * The shape FitBot returns when it edits a routine.
 *
 * Tolerant on purpose, the same lesson `program-schema.ts` already paid for:
 * `z.enum().default()` does not rescue an INVALID value, only a missing one, so
 * a model that answers "8-10" where a number was wanted fails the whole parse
 * AFTER the quota unit has been charged. Anything that can be coerced is
 * coerced here rather than rejected.
 */

/** Reps are free text by contract: "6-8", "AMRAP", "30s". Numbers are stringified. */
const repsField = z.preprocess(
  (v) => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : v),
  z.string().trim().min(1).max(40).catch("8"),
);

const clampInt = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => {
    const n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && Number.isFinite(n)
      ? Math.min(Math.max(Math.round(n), min), max)
      : fallback;
  }, z.number().int());

export const EditedExerciseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sets: clampInt(1, 10, 3),
  reps: repsField,
  rest: clampInt(0, 600, 90),
  notes: z.string().max(400).optional().default(""),
  // Only anchors carry one, and only the deterministic progression sets it, so
  // an edit must be able to leave it alone rather than invent one.
  targetLoadLbs: z
    .preprocess((v) => (v === null || v === undefined || v === "" ? undefined : v), z.coerce.number().min(0).max(2000))
    .optional(),
});

export const EditedDaySchema = z.object({
  dayIndex: clampInt(1, 60, 1),
  workoutName: z.string().trim().min(1).max(120),
  exercises: z.array(EditedExerciseSchema).min(1).max(20),
});

export const EditedRoutineSchema = z.object({
  /** Every training day, in order. Rest days are simply absent. */
  days: z.array(EditedDaySchema).min(1).max(60),
  /** Rotation period in days, so the Routines card can draw the cycle strip. */
  cycleLength: clampInt(1, 60, 7).optional(),
  changes: z
    .array(
      z.object({
        type: z.string().max(20),
        detail: z.string().max(300),
      }),
    )
    .max(40)
    .default([]),
  summary: z.string().max(400).default(""),
});

export type EditedRoutine = z.infer<typeof EditedRoutineSchema>;
export type EditedDay = z.infer<typeof EditedDaySchema>;
