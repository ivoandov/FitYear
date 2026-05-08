import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { routines, routineEntries } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

const DAY_INDEX_BY_NAME: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

const ExerciseSchema = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.string(),
  rest: z.number(),
  notes: z.string().optional(),
});

const ProgramSchema = z.object({
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

const InputSchema = z.object({
  program: ProgramSchema,
  focus: z.array(z.string()),
  experience: z.string(),
  programLength: z.number().int().min(7).max(180),
});

// Persists a Fit Bot-generated program. Split out from the streaming generator
// route so the slow Anthropic call and the quick DB writes never share a
// function invocation budget.
export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const { program, focus, experience, programLength } = InputSchema.parse(
    await request.json(),
  );

  const [routine] = await db
    .insert(routines)
    .values({
      userId: user.id,
      name: program.name,
      description: `Built by Fit Bot · ${focus.join(" + ")} · ${experience}`,
      defaultDurationDays: programLength,
      isPublic: false,
    })
    .returning();

  const entries: Array<{
    routineId: string;
    dayIndex: number;
    workoutName: string | null;
    exercises: unknown;
  }> = [];
  for (const week of program.weeks) {
    for (const day of week.days) {
      if (day.isRest) continue;
      const dow = DAY_INDEX_BY_NAME[day.dayOfWeek] ?? 1;
      const dayIndex = (week.weekNum - 1) * 7 + dow;
      entries.push({
        routineId: routine.id,
        dayIndex,
        workoutName: day.workoutName,
        exercises: day.exercises,
      });
    }
  }
  if (entries.length) {
    await db.insert(routineEntries).values(entries);
  }

  return {
    routineId: routine.id,
    name: program.name,
    weeksGenerated: program.weeks.length,
    daysGenerated: entries.length,
  };
});
