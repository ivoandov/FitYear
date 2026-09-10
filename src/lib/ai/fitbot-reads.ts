import { and, desc, eq, gte, ilike, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bodyMeasurements,
  completedWorkouts,
  exercises,
  routineInstances,
  routines,
  scheduledWorkouts,
  userSettings,
  workoutExercises,
  workoutSets,
} from "@/lib/db/schema";
import { loadTrainingHistory } from "@/lib/api/training-history";
import { getActiveRoutineAdherence } from "@/lib/api/routine-adherence";
import { scheduledDateKey } from "@/lib/date";
import { routineEntries } from "@/lib/db/schema";

/**
 * The read half of FitBot's tool surface.
 *
 * Every function here is scoped to ONE user id, which the route takes from the
 * session and never from the model. A tool argument naming a user would be a
 * master key over every account, which is the same reasoning that keeps the
 * read-only integration endpoint bound to a single id.
 *
 * These return SHAPES BUILT FOR A MODEL TO READ, not the raw rows: names and
 * numbers, no internal columns beyond the ids it needs to propose an action.
 * That is a token-economy decision as much as a clarity one - the whole result
 * is re-sent on every subsequent turn of the conversation.
 */

export type ReadToolName =
  | "get_training_summary"
  | "get_active_program"
  | "list_routines"
  | "get_routine"
  | "list_recent_workouts"
  | "search_exercises"
  | "list_upcoming_workouts"
  | "get_body_measurements"
  | "get_personal_records"
  | "get_settings";

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function getTrainingSummary(userId: string, tz: string) {
  const history = await loadTrainingHistory(userId, tz);
  return {
    totalWorkouts: history.totalWorkouts,
    // Sets per week against the user's OWN average, never an invented ideal.
    muscleGroups: history.verdicts.map((v) => ({
      group: v.group,
      setsLast7Days: v.sets7,
      /** This user's own weekly norm, which is what a shortfall is judged against. */
      baselineSetsPerWeek: v.baselineWeekly,
      daysSinceTrained: v.daysSince,
      status: v.status,
      reason: v.reason,
    })),
    favoriteExercises: Object.fromEntries(
      [...history.favoritesByGroup].map(([group, list]) => [
        group,
        list.slice(0, 5).map((e) => ({ name: e.name, sets: e.sets })),
      ]),
    ),
  };
}

async function getActiveProgram(userId: string) {
  const adherence = await getActiveRoutineAdherence(userId);
  if (!adherence) {
    return { active: false, message: "No program is currently running." };
  }
  return {
    active: true,
    routineId: adherence.routineId,
    routineName: adherence.summary.routineName,
    sessionsCompleted: adherence.summary.sessionsCompleted,
    // "No sessions yet" and "no changes" are different statements and the model
    // must not confuse them.
    noSessionsYet: adherence.summary.noData,
    plan: adherence.plan,
    driftFromPlan: adherence.summary.patterns,
  };
}

async function listRoutines(userId: string) {
  const rows = await db
    .select({
      id: routines.id,
      name: routines.name,
      description: routines.description,
      defaultDurationDays: routines.defaultDurationDays,
    })
    .from(routines)
    .where(eq(routines.userId, userId));

  const active = await db
    .select({ routineId: routineInstances.routineId })
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.userId, userId),
        eq(routineInstances.status, "active"),
      ),
    );
  const activeIds = new Set(active.map((a) => a.routineId));

  const counts = await db
    .select({ routineId: routineEntries.routineId, n: sql<number>`count(*)::int` })
    .from(routineEntries)
    .groupBy(routineEntries.routineId);
  const countBy = new Map(counts.map((c) => [c.routineId, c.n]));

  return rows.map((r) => ({
    ...r,
    trainingDays: countBy.get(r.id) ?? 0,
    isRunning: activeIds.has(r.id),
  }));
}

async function getRoutine(userId: string, routineId: string) {
  // Ownership is checked on the ROUTINE; entries are read through it rather
  // than trusted from the argument, because routine_entries.routine_id has no
  // foreign key to lean on.
  const [routine] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, routineId), eq(routines.userId, userId)))
    .limit(1);
  if (!routine) return { error: "Routine not found." };

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, routineId));

  return {
    id: routine.id,
    name: routine.name,
    days: entries
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map((e) => ({
        dayIndex: e.dayIndex,
        workoutName: e.workoutName,
        exercises: e.exercises ?? [],
      })),
  };
}

async function listRecentWorkouts(userId: string, limit: number) {
  const capped = Math.min(Math.max(limit || 10, 1), 30);
  const workouts = await db
    .select({
      id: completedWorkouts.id,
      name: completedWorkouts.name,
      completedAt: completedWorkouts.completedAt,
      durationSeconds: completedWorkouts.durationSeconds,
      routineDayIndex: completedWorkouts.routineDayIndex,
    })
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, userId))
    .orderBy(desc(completedWorkouts.completedAt))
    .limit(capped);

  const out = [];
  for (const w of workouts) {
    // COMPLETED sets only: the tracker prefills rows from history, so an
    // abandoned exercise still carries weight and reps at completed=false.
    const rows = await db
      .select({
        name: workoutExercises.nameSnapshot,
        exerciseType: workoutExercises.exerciseType,
        weightLbs: workoutSets.weightLbs,
        reps: workoutSets.reps,
        time: workoutSets.time,
      })
      .from(workoutExercises)
      .innerJoin(workoutSets, eq(workoutSets.workoutExerciseId, workoutExercises.id))
      .where(
        and(
          eq(workoutExercises.completedWorkoutId, w.id),
          eq(workoutSets.completed, true),
        ),
      );

    const byName = new Map<string, { name: string; sets: { weightLbs?: number; reps?: number; seconds?: number }[] }>();
    for (const r of rows) {
      const name = r.name ?? "";
      if (!name) continue;
      const entry = byName.get(name) ?? { name, sets: [] };
      entry.sets.push({
        weightLbs: num(r.weightLbs),
        reps: num(r.reps),
        seconds: num(r.time),
      });
      byName.set(name, entry);
    }

    out.push({
      id: w.id,
      name: w.name,
      date: w.completedAt.toISOString().slice(0, 10),
      durationMinutes: w.durationSeconds ? Math.round(w.durationSeconds / 60) : null,
      routineDayIndex: w.routineDayIndex,
      exercises: [...byName.values()],
    });
  }
  return out;
}

async function searchExercises(query?: string, muscleGroup?: string) {
  const conditions = [];
  if (query) conditions.push(ilike(exercises.name, `%${query}%`));
  // The catalog is SHARED, so this is deliberately not user-scoped: the model
  // should reuse an existing row rather than propose a near-duplicate.
  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      muscleGroups: exercises.muscleGroups,
      exerciseType: exercises.exerciseType,
    })
    .from(exercises)
    .where(conditions.length ? and(...conditions) : undefined)
    .limit(60);

  const filtered = muscleGroup
    ? rows.filter((r) =>
        JSON.stringify(r.muscleGroups ?? []).toLowerCase().includes(muscleGroup.toLowerCase()),
      )
    : rows;

  return filtered.slice(0, 40);
}

async function listUpcomingWorkouts(userId: string) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      id: scheduledWorkouts.id,
      name: scheduledWorkouts.name,
      date: scheduledWorkouts.date,
      exercises: scheduledWorkouts.exercises,
      routineDayIndex: scheduledWorkouts.routineDayIndex,
    })
    .from(scheduledWorkouts)
    .where(
      and(eq(scheduledWorkouts.userId, userId), gte(scheduledWorkouts.date, todayStart)),
    )
    .orderBy(scheduledWorkouts.date);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    // An AUTHORED day, read with the zone-free helper. Resolving it in a
    // viewer's zone reports every session a day late from UTC+12 east.
    date: scheduledDateKey(r.date),
    routineDayIndex: r.routineDayIndex,
    exercises: r.exercises ?? [],
  }));
}

async function getBodyMeasurements(userId: string) {
  const rows = await db
    .select()
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.userId, userId))
    .orderBy(desc(bodyMeasurements.measuredOn))
    .limit(20);

  return rows.map((r) => ({
    measuredOn: scheduledDateKey(r.measuredOn),
    weightLbs: r.weightLbs,
    bodyFatPct: r.bodyFatPct,
    circumferences: r.circumferences,
    notes: r.notes,
  }));
}

async function getPersonalRecords(userId: string, limit: number) {
  const capped = Math.min(Math.max(limit || 20, 1), 50);
  // Heaviest completed set per exercise name. Assisted lifts are excluded
  // rather than reported wrong: on an assisted lift the weight column is
  // counter-assistance, so the heaviest row is the EASIEST set, and every
  // surface that ever read it plainly inverted the ranking.
  const rows = await db
    .select({
      name: workoutExercises.nameSnapshot,
      topWeightLbs: sql<number>`max(${workoutSets.weightLbs})`,
    })
    .from(workoutExercises)
    .innerJoin(workoutSets, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(
      completedWorkouts,
      eq(completedWorkouts.id, workoutExercises.completedWorkoutId),
    )
    .where(
      and(
        eq(completedWorkouts.userId, userId),
        eq(workoutSets.completed, true),
        sql`coalesce(${workoutExercises.isAssisted}, false) = false`,
      ),
    )
    .groupBy(workoutExercises.nameSnapshot)
    .limit(capped);

  return rows.filter((r) => r.name && r.topWeightLbs != null);
}

async function getSettings(userId: string) {
  const [s] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return {
    weightUnit: s?.weightUnit ?? "lbs",
    monthlyWorkoutGoal: s?.monthlyWorkoutGoal ?? 16,
    fitbotDefaultFocus: s?.fitbotDefaultFocus ?? "strength",
    timeZone: s?.timeZone ?? null,
  };
}

/**
 * Run one read tool. Unknown names return an error OBJECT rather than throwing:
 * a thrown tool error would kill the whole conversation, where a returned one
 * lets the model correct itself on the next turn.
 */
export async function runReadTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { userId: string; tz: string },
): Promise<unknown> {
  switch (name as ReadToolName) {
    case "get_training_summary":
      return getTrainingSummary(ctx.userId, ctx.tz);
    case "get_active_program":
      return getActiveProgram(ctx.userId);
    case "list_routines":
      return listRoutines(ctx.userId);
    case "get_routine":
      return getRoutine(ctx.userId, String(input.routineId ?? ""));
    case "list_recent_workouts":
      return listRecentWorkouts(ctx.userId, Number(input.limit ?? 10));
    case "search_exercises":
      return searchExercises(
        input.query ? String(input.query) : undefined,
        input.muscleGroup ? String(input.muscleGroup) : undefined,
      );
    case "list_upcoming_workouts":
      return listUpcomingWorkouts(ctx.userId);
    case "get_body_measurements":
      return getBodyMeasurements(ctx.userId);
    case "get_personal_records":
      return getPersonalRecords(ctx.userId, Number(input.limit ?? 20));
    case "get_settings":
      return getSettings(ctx.userId);
    default:
      return { error: `Unknown tool "${name}".` };
  }
}
