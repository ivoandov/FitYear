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
export const GeneratedExerciseSchema = z.object({
  name: z.string().min(1),
  muscleGroups: z.array(z.string()).default([]),
  exerciseType: z.enum(["weight_reps", "distance_time"]).default("weight_reps"),
  isAssisted: z.boolean().default(false),
  sets: z.number().int().min(1).max(20),
  reps: z.string(), // free-form: "8-12", "AMRAP", "30s"
  rest: z.number().int().min(0).max(600), // seconds
  notes: z.string().default(""),
});

export const GeneratedWorkoutSchema = z.object({
  name: z.string().min(1),
  estimatedMinutes: z.number().int().min(1).max(240).optional(),
  targetMuscles: z.array(z.string()).default([]),
  equipment: z.array(z.string()).default([]),
  exercises: z.array(GeneratedExerciseSchema).min(1),
});

export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>;
export type GeneratedWorkout = z.infer<typeof GeneratedWorkoutSchema>;
