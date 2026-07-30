import { z } from "zod";

/**
 * Shape of a single-workout FitBot generation ("a workout for the day").
 *
 * The model is NOT bound to the exercise library, so each exercise is
 * self-describing: it carries the metadata we'd otherwise look up from a library
 * row (muscle groups, type, assisted flag). That metadata is needed to render
 * the preview, to create a custom exercise on Start if the movement is new, and
 * for correct PR detection (isAssisted inverts the weight comparison on assisted
 * machines).
 *
 * Both the generate and refine endpoints validate against this shape, and the
 * client validates the streamed result against it before showing the preview, so
 * the two never drift. See FITBOT_TECH_SPEC.md section 1.6.
 */
// Length caps throughout: `refine-workout` accepts a whole workout from the
// client and stringifies it into the prompt, so an uncapped field let one quota
// unit buy an arbitrarily large paid call. All limits sit far above real output.
export const GeneratedExerciseSchema = z.object({
  name: z.string().min(1).max(120),
  muscleGroups: z.array(z.string().max(100)).max(20).default([]),
  exerciseType: z.enum(["weight_reps", "distance_time"]).default("weight_reps"),
  isAssisted: z.boolean().default(false),
  sets: z.number().int().min(1).max(20),
  reps: z.string().max(40), // free-form: "8-12", "AMRAP", "30s"
  rest: z.number().int().min(0).max(600), // seconds
  notes: z.string().max(500).default(""),
});

export const GeneratedWorkoutSchema = z.object({
  name: z.string().min(1).max(120),
  estimatedMinutes: z.number().int().min(1).max(240).optional(),
  targetMuscles: z.array(z.string().max(100)).max(30).default([]),
  equipment: z.array(z.string().max(100)).max(30).default([]),
  exercises: z.array(GeneratedExerciseSchema).min(1).max(30),
});

export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>;
export type GeneratedWorkout = z.infer<typeof GeneratedWorkoutSchema>;

/**
 * Refinement response. The refine endpoint returns the full revised workout PLUS
 * a structured diff so the preview can render the "1 change applied / SWAPPED /
 * was X / N unchanged" UI reliably (the model authors the change, so it reports
 * it). See FITBOT_TECH_SPEC.md section 1.3 (3d).
 */
export const WorkoutChangeSchema = z.object({
  type: z.enum(["swap", "add", "remove", "modify"]),
  name: z.string(), // the resulting exercise (or the removed one)
  previousName: z.string().optional(), // for swaps / modifies
  reason: z.string().optional(), // short "why" (injury-aware, etc.)
});

export const RefinedWorkoutSchema = z.object({
  workout: GeneratedWorkoutSchema,
  changes: z.array(WorkoutChangeSchema).default([]),
  summary: z.string().default(""),
});

export type WorkoutChange = z.infer<typeof WorkoutChangeSchema>;
export type RefinedWorkout = z.infer<typeof RefinedWorkoutSchema>;
