import { z } from "zod";

// Shared Fit Bot program shape. The client (fit-bot/page.tsx) validates the
// streamed LLM output against this before saving; the server (ai/save-program)
// validates it again on write. One definition so the two never drift.
export const ExerciseSchema = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.string(),
  rest: z.number(),
  notes: z.string().optional(),
});

export const ProgramSchema = z.object({
  name: z.string(),
  weeks: z.array(
    z.object({
      weekNum: z.number(),
      days: z.array(
        z.object({
          dayOfWeek: z.string(),
          workoutName: z.string(),
          isRest: z.boolean(),
          exercises: z.array(ExerciseSchema).default([]),
        }),
      ),
    }),
  ),
});

export type Program = z.infer<typeof ProgramSchema>;

// --- Program skeleton (stage 1 of the segmented program builder) ---
// The model returns this compact macrocycle spec in ONE fast call: the split,
// the phase layout, and the anchor lifts with STRUCTURED progression params.
// Progression is then expanded deterministically in code (lib/program-progression.ts),
// not by the model, so week-to-week loads are consistent and correct. Per-phase
// "variety" exercises are authored by separate LLM calls (stage 2) and layered on
// top. Segmenting like this keeps every call well under the 60s function limit.
// See FITBOT_TECH_SPEC.md section 2.4.

export const AnchorProgressionSchema = z.object({
  // v1 is linear load progression: reps/sets fixed, load climbs each non-deload
  // week. The enum leaves room for rep-based or percentage schemes later.
  scheme: z.literal("linear").default("linear"),
  startLoadLbs: z.number().min(0), // 0 for bodyweight anchors
  incrementLbs: z.number().min(0), // added each non-deload week
  sets: z.number().int().min(1).max(10),
  reps: z.string(), // "5", "8-12"
});

export const AnchorLiftSchema = z.object({
  name: z.string(),
  muscleGroups: z.array(z.string()).default([]),
  exerciseType: z.enum(["weight_reps", "distance_time"]).default("weight_reps"),
  isAssisted: z.boolean().default(false),
  progression: AnchorProgressionSchema,
});

export const SplitDaySchema = z.object({
  dayLabel: z.string(), // "Upper A", "Lower", "Push"
  dayOfWeek: z.string(), // "Monday" — maps to the calendar day save uses
  muscleGroups: z.array(z.string()).default([]),
  anchorLifts: z.array(AnchorLiftSchema).default([]),
});

export const PhaseSchema = z.object({
  name: z.string(), // "Hypertrophy Base", "Strength", "Peak"
  focus: z.string(),
  startWeek: z.number().int().min(1),
  endWeek: z.number().int().min(1),
});

export const SkeletonSchema = z.object({
  name: z.string(),
  durationWeeks: z.number().int().min(1).max(52),
  daysPerWeek: z.number().int().min(1).max(7),
  split: z.array(SplitDaySchema).min(1),
  phases: z.array(PhaseSchema).min(1),
  deloadWeeks: z.array(z.number().int().min(1)).default([]), // 1-indexed weeks
  deloadLoadFactor: z.number().min(0.5).max(1).default(0.9),
});

export type AnchorProgression = z.infer<typeof AnchorProgressionSchema>;
export type AnchorLift = z.infer<typeof AnchorLiftSchema>;
export type SplitDay = z.infer<typeof SplitDaySchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type Skeleton = z.infer<typeof SkeletonSchema>;
