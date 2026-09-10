import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  routineEntries,
  routineInstances,
  routines,
  workoutExercises,
  workoutSets,
} from "@/lib/db/schema";
import {
  summarizeAdherence,
  type AdherenceSummary,
  type PerformedExercise,
  type PerformedSession,
  type PlannedExercise,
} from "@/lib/routine-adherence";

/**
 * Assemble the plan-versus-actual picture for a user's ACTIVE program.
 *
 * The join that makes this possible is `completed_workouts.routine_day_index`,
 * which nothing wrote until 2026-09-10. Sessions saved before that were
 * backfilled by matching the workout NAME to a routine entry, never by parsing
 * the "Day N" inside it: that label is the plan's own numbering and disagrees
 * with dayIndex whenever the rotation has rest gaps.
 *
 * A session with a null day index is skipped rather than guessed at. Attaching
 * it to the wrong day would put words in the user's mouth about a workout they
 * did not do.
 */

/** A routine entry's inline exercise array, which is name-only jsonb. */
type InlineExercise = {
  name?: unknown;
  sets?: unknown;
  reps?: unknown;
  plannedSets?: unknown;
  plannedReps?: unknown;
  targetLoadLbs?: unknown;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Read one planned exercise out of a routine entry.
 *
 * Import writes `sets`/`reps`; FitBot writes `plannedSets`/`plannedReps`. Both
 * shapes are live, so reading only one silently loses a whole class of plan.
 * `reps` stays a STRING throughout: "6-8", "AMRAP", "30s".
 */
export function readPlanned(raw: unknown): PlannedExercise | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as InlineExercise;
  const name = typeof e.name === "string" ? e.name.trim() : "";
  if (!name) return null;

  const reps = e.reps ?? e.plannedReps;
  return {
    name,
    sets: num(e.sets) ?? num(e.plannedSets),
    reps: reps == null ? null : String(reps),
    targetLoadLbs: num(e.targetLoadLbs),
  };
}

function plannedFromEntry(exercises: unknown): PlannedExercise[] {
  if (!Array.isArray(exercises)) return [];
  return exercises
    .map(readPlanned)
    .filter((x): x is PlannedExercise => x !== null);
}

export interface ActiveRoutineAdherence {
  instanceId: string;
  routineId: string;
  summary: AdherenceSummary;
  /** The plan itself, so a caller can show or reason about what was prescribed. */
  plan: {
    dayIndex: number;
    workoutName: string | null;
    exercises: PlannedExercise[];
  }[];
}

/**
 * Null when the user has no active program - which is a legitimate answer, not
 * an error, and callers must render it as "no program running" rather than as
 * an empty analysis.
 */
export async function getActiveRoutineAdherence(
  userId: string,
): Promise<ActiveRoutineAdherence | null> {
  const [instance] = await db
    .select({
      id: routineInstances.id,
      routineId: routineInstances.routineId,
      routineName: routineInstances.routineName,
    })
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.userId, userId),
        eq(routineInstances.status, "active"),
      ),
    )
    .limit(1);
  if (!instance) return null;

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, instance.routineId));

  // The routine may have been renamed since the program started; the live name
  // is the one the user would recognise.
  const [routine] = await db
    .select({ name: routines.name })
    .from(routines)
    .where(and(eq(routines.id, instance.routineId), eq(routines.userId, userId)))
    .limit(1);

  const finished = await db
    .select({
      id: completedWorkouts.id,
      dayIndex: completedWorkouts.routineDayIndex,
      completedAt: completedWorkouts.completedAt,
    })
    .from(completedWorkouts)
    .where(
      and(
        eq(completedWorkouts.userId, userId),
        eq(completedWorkouts.routineInstanceId, instance.id),
        // A session whose day is unknown is left out entirely. See the note above.
        isNotNull(completedWorkouts.routineDayIndex),
      ),
    );

  const sessionsByDay = new Map<number, PerformedSession[]>();
  for (const w of finished) {
    // COMPLETED sets only. The tracker prefills rows from history, so an
    // abandoned exercise still carries weight and reps with completed=false;
    // counting those would report work nobody did.
    const rows = await db
      .select({
        name: workoutExercises.nameSnapshot,
        weightLbs: workoutSets.weightLbs,
      })
      .from(workoutExercises)
      .innerJoin(
        workoutSets,
        eq(workoutSets.workoutExerciseId, workoutExercises.id),
      )
      .where(
        and(
          eq(workoutExercises.completedWorkoutId, w.id),
          eq(workoutSets.completed, true),
        ),
      );

    const byName = new Map<string, PerformedExercise>();
    for (const r of rows) {
      const name = r.name ?? "";
      if (!name) continue;
      const entry = byName.get(name) ?? { name, sets: 0, topWeightLbs: null };
      entry.sets += 1;
      if (r.weightLbs != null) {
        entry.topWeightLbs = Math.max(entry.topWeightLbs ?? 0, r.weightLbs);
      }
      byName.set(name, entry);
    }

    const dayIndex = w.dayIndex as number;
    const list = sessionsByDay.get(dayIndex) ?? [];
    list.push({
      completedWorkoutId: w.id,
      dayIndex,
      completedAt: w.completedAt,
      exercises: [...byName.values()],
    });
    sessionsByDay.set(dayIndex, list);
  }

  const days = entries
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map((e) => ({
      dayIndex: e.dayIndex,
      workoutName: e.workoutName,
      planned: plannedFromEntry(e.exercises),
      sessions: sessionsByDay.get(e.dayIndex) ?? [],
    }));

  return {
    instanceId: instance.id,
    routineId: instance.routineId,
    summary: summarizeAdherence(
      routine?.name ?? instance.routineName,
      days,
    ),
    plan: days.map((d) => ({
      dayIndex: d.dayIndex,
      workoutName: d.workoutName,
      exercises: d.planned,
    })),
  };
}
