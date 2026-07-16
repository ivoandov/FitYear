import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { routines, routineEntries, exercises } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { ProgramSchema } from "@/lib/program-schema";
import { matchExercise, normalizeExerciseName } from "@/lib/exercise-match";

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
      // Persist the rotation period so the Routines card can render the true
      // cycle (workout/rest rotation) instead of the weekday-collapse strip.
      cycleLength: program.cycleLength,
      isPublic: false,
    })
    .returning();

  // Reconcile each generated exercise name against the shared catalog so the
  // program reuses an existing exercise (its identity, history, image) instead
  // of spawning a near-duplicate - e.g. "Incline Bicep Curls" when "Bicep Curls
  // - Incline" already exists. The matcher (lib/exercise-match) is order- and
  // plural-insensitive. Names that match nothing are genuinely new, so they're
  // de-duplicated WITHIN this program (first spelling wins) so the same movement
  // doesn't recur under two spellings across phases. Only the display name is
  // rewritten; the set/rep/rest/load prescription is untouched.
  const catalog = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises);
  const chosenForNew = new Map<string, string>();
  let exercisesReconciled = 0;
  const reconcileName = (raw: string): string => {
    const match = matchExercise(raw, catalog);
    if (match) {
      if (match.name !== raw) exercisesReconciled++;
      return match.name;
    }
    const key = normalizeExerciseName(raw);
    const prior = chosenForNew.get(key);
    if (prior !== undefined) {
      if (prior !== raw) exercisesReconciled++;
      return prior;
    }
    chosenForNew.set(key, raw);
    return raw;
  };

  const entries = program.days
    .filter((day) => !day.isRest)
    .map((day) => ({
      routineId: routine.id,
      dayIndex: day.dayIndex,
      workoutName: day.workoutName,
      exercises: day.exercises.map((ex) => ({
        ...ex,
        name: reconcileName(ex.name),
      })) as unknown,
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
    exercisesReconciled,
  };
});
