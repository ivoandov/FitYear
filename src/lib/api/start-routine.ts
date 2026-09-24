import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { routines, routineEntries, routineInstances, scheduledWorkouts } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/auth";
import { expandRoutineSchedule, isExpandedProgram } from "@/lib/routine-schedule";
import { progressedExercises } from "@/lib/progression";
import { loadAssistedCheck } from "@/lib/api/assisted";
import { isUniqueViolation } from "@/lib/api/pg-errors";
import { addDaysToDateKey, localDateKeyInZone, scheduledDateFromKey } from "@/lib/date";

/**
 * Start a routine: the instance that tracks it and every session on the calendar.
 *
 * This is the body of `POST /api/routines/[id]/start`, lifted out on 2026-09-23 so
 * the integration door could start a program through exactly the code the Start
 * button uses. Every guarantee in here (the repeat across the duration, the
 * per-week progression, the date-conflict refusal, the one-active-instance
 * index) existed before the move; the move added none and removed none.
 *
 * Throws `ApiError` for every refusal, the way the route always did, so a caller
 * inside `handle` answers the same status codes it always answered.
 */
export interface StartRoutineInput {
  userId: string;
  routineId: string;
  /** Anything `Date.parse` accepts; resolved to a calendar day in `timeZone`. */
  startDate: string;
  durationDays?: number;
  /** The viewer's zone. A route reads the cookie; a machine caller passes what it knows. */
  timeZone: string;
}

export async function startRoutine(input: StartRoutineInput) {
  const { userId, routineId } = input;

  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, routineId))
    .limit(1);
  if (!routine) throw new ApiError(404, "Routine not found");
  if (routine.userId !== userId && !routine.isPublic) {
    throw new ApiError(403, "Access denied");
  }

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, routineId));

  const maxDays = input.durationDays ?? routine.defaultDurationDays;
  const named = entries.filter((e) => e.workoutName);
  if (named.length === 0) {
    throw new ApiError(400, "No workout entries found for the specified duration");
  }

  // Check date conflicts
  const existing = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.userId, userId));
  const existingDates = new Set(
    existing.map((w) => new Date(w.date).toISOString().split("T")[0]),
  );

  const startDate = new Date(input.startDate);
  // The calendar day the user picked, resolved in THEIR zone rather than the
  // server's (UTC on Vercel). Every date below is derived from this KEY by
  // calendar arithmetic, so no step ever depends on a machine's local clock.
  const startKey = localDateKeyInZone(startDate, input.timeZone);

  // REPEAT the cycle across the chosen duration. Until 2026-09-18 a routine
  // scheduled one pass and the duration only filtered entries out, so starting
  // a 3-day routine "for 8 weeks" produced three sessions. A FitBot program,
  // whose entries already reach past one rotation, still gets exactly one pass.
  const occurrences = expandRoutineSchedule(named, {
    startKey,
    durationDays: maxDays,
    cycleLength: routine.cycleLength,
  });
  if (occurrences.length === 0) {
    throw new ApiError(400, "No workout entries found for the specified duration");
  }

  /**
   * Bake each session's target load from the routine's progression rule.
   *
   * Computed HERE, per occurrence, because the week is known here and nowhere
   * downstream: the scheduled workout is just a date and a list of exercises.
   * `targetLoadLbs` is the field the tracker already prefills set one from, so
   * once it is written the whole existing path carries it with no change.
   * `progressedExercises` is shared with the re-sync of a running program, so
   * the two cannot compute different weeks differently.
   *
   * A FitBot program is left exactly as built: each of its entries already
   * carries that week's computed load, and a rule on top would climb it twice.
   */
  const expanded = isExpandedProgram(named, routine.cycleLength);
  const isAssisted = expanded ? () => false : await loadAssistedCheck();
  const applyProgression = (exercises: unknown, week: number): unknown =>
    expanded
      ? (exercises ?? [])
      : progressedExercises(
          exercises,
          routine.progression as Record<string, unknown> | null,
          week,
          isAssisted,
        );

  const conflicts: string[] = [];
  for (const o of occurrences) {
    if (existingDates.has(o.dateKey)) conflicts.push(o.dateKey);
  }
  if (conflicts.length > 0) {
    throw new ApiError(409, "Scheduling conflicts found", {
      conflicts,
      message: `Workouts already exist on: ${conflicts.join(", ")}`,
    });
  }

  const endDate = scheduledDateFromKey(addDaysToDateKey(startKey, maxDays - 1));

  // One transaction: the instance and its scheduled workouts must land
  // together. Separately, a failed bulk insert left an ACTIVE instance
  // claiming N workouts with nothing on the calendar.
  let instance: typeof routineInstances.$inferSelect;
  let createdWorkouts: (typeof scheduledWorkouts.$inferSelect)[];
  try {
    ({ instance, createdWorkouts } = await db.transaction(async (tx) => {
      const [inst] = await tx
        .insert(routineInstances)
        .values({
          routineId,
          userId,
          routineName: routine.name,
          startDate: scheduledDateFromKey(startKey),
          endDate,
          durationDays: maxDays,
          // The denominator of every progress readout, so it has to count the
          // REPEATS rather than the entries - a routine that repeats four times
          // can otherwise never reach 100%.
          totalWorkouts: occurrences.length,
          completedWorkouts: 0,
          status: "active",
        })
        .returning();

      const created = await tx
        .insert(scheduledWorkouts)
        .values(
          occurrences.map(({ entry, dateKey, week }) => {
            // Calendar arithmetic on the DAY KEY, then anchored at noon UTC.
            // This used to add days to a Date and store the result, which is
            // local midnight - 07:00Z for Los Angeles - and any zone west of the
            // creating one then read it as the previous day. See
            // scheduledDateFromKey.
            const d = scheduledDateFromKey(dateKey);
            return {
              userId,
              name: entry.workoutName || `Day ${entry.dayIndex}`,
              date: d,
              exercises: applyProgression(entry.exercises, week),
              templateId: entry.workoutTemplateId ?? null,
              routineInstanceId: inst.id,
              // The ROUTINE DAY, not the day of the program: every repeat of a
              // cycle maps back to the same routine entry, which is what the
              // plan-versus-actual join and the re-sync both match on.
              routineDayIndex: entry.dayIndex,
            };
          }),
        )
        .returning();

      return { instance: inst, createdWorkouts: created };
    }));
  } catch (e) {
    // The partial unique index (one ACTIVE instance per user+routine) rejected
    // this one, i.e. a double-tap on Start where both requests cleared the
    // date-conflict pre-check. Return the instance that won instead of a 500,
    // so the second tap is a no-op rather than a double-booked program.
    if (isUniqueViolation(e)) {
      const [winner] = await db
        .select()
        .from(routineInstances)
        .where(
          and(
            eq(routineInstances.userId, userId),
            eq(routineInstances.routineId, routineId),
            eq(routineInstances.status, "active"),
          ),
        )
        .limit(1);
      if (winner) {
        throw new ApiError(409, "This routine is already running", {
          routineInstanceId: winner.id,
        });
      }
    }
    throw e;
  }

  return { instance, createdWorkouts };
}
