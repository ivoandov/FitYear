import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { routines, routineEntries } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { ProgramSchema } from "@/lib/program-schema";

const InputSchema = z.object({
  program: ProgramSchema,
  focus: z.array(z.string()),
  experience: z.string(),
  programLength: z.number().int().min(7).max(180),
  distinctWorkouts: z.number().int().min(1).max(8).optional(),
});

// Persists a Fit Bot-generated program. Split out from the generator route so
// the slow Anthropic call and the quick DB writes never share a function
// invocation budget. The program is a flat rotating-cycle sequence: each
// non-rest day carries its absolute 1-indexed `dayIndex`, which routine_entries
// stores verbatim and the routine-start route turns into a calendar date
// (startDate + dayIndex - 1). Rest days have no entry, so they become gaps in
// the schedule. No weekday mapping is involved.
export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const { program, focus, experience, programLength, distinctWorkouts } =
    InputSchema.parse(await request.json());

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

  const entries = program.days
    .filter((day) => !day.isRest)
    .map((day) => ({
      routineId: routine.id,
      dayIndex: day.dayIndex,
      workoutName: day.workoutName,
      exercises: day.exercises as unknown,
    }));
  if (entries.length) {
    await db.insert(routineEntries).values(entries);
  }

  return {
    routineId: routine.id,
    name: program.name,
    cycleLength: program.cycleLength,
    distinctWorkouts: distinctWorkouts ?? null,
    weeksGenerated: Math.ceil(programLength / 7),
    daysGenerated: entries.length,
  };
});
