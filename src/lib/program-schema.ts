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
