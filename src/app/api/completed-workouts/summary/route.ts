import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  workoutExercises,
  workoutSets,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

/**
 * Every completed workout, WITHOUT its exercises and sets.
 *
 * `/api/completed-workouts` assembles every set of every workout from the
 * normalized tables: 79 workouts, 1,678 sets, ~208KB and ~375ms of database
 * work, growing forever - and it was loaded by the workout context, which lives
 * in the app layout, so every page in the app paid it.
 *
 * Almost nothing needed the sets. What the app asks of this list, page by page,
 * is "how many workouts", "which days did I train", "how many times have I used
 * this template" and "what were the last six". All of that is metadata plus two
 * counts, and both counts are cheaper to compute in SQL than to ship.
 *
 * The full endpoint still exists, unchanged, for History - the one page that
 * actually renders the sets.
 */
export const GET = handle(async () => {
  const { user } = await requireUser();

  // Counted in SQL rather than shipped: `totalSets` and `totalReps` are the
  // only things the metadata consumers derived from the set rows, and summing
  // 1,678 of them server-side costs nothing next to sending them.
  const counts = db
    .select({
      completedWorkoutId: workoutExercises.completedWorkoutId,
      // COMPLETED sets only, the rule every other total here follows: the
      // tracker prefills rows from history, so an abandoned exercise still
      // carries weight and reps at completed=false.
      totalSets: sql<number>`count(*) filter (where ${workoutSets.completed})::int`.as("total_sets"),
      totalReps: sql<number>`coalesce(sum(${workoutSets.reps}) filter (where ${workoutSets.completed}), 0)::int`.as("total_reps"),
    })
    .from(workoutExercises)
    .innerJoin(workoutSets, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .groupBy(workoutExercises.completedWorkoutId)
    .as("counts");

  // Exercise IDS are included, sets are not. Ids are a few short strings per
  // workout and Home needs them for its "N exercises" line and the card image;
  // the 1,678 set rows are what actually made this payload expensive.
  const exerciseIds = db
    .select({
      completedWorkoutId: workoutExercises.completedWorkoutId,
      ids: sql<string[]>`array_agg(${workoutExercises.exerciseId} order by ${workoutExercises.position})`.as("ids"),
    })
    .from(workoutExercises)
    .groupBy(workoutExercises.completedWorkoutId)
    .as("exercise_ids");

  const rows = await db
    .select({
      id: completedWorkouts.id,
      displayId: completedWorkouts.displayId,
      templateId: completedWorkouts.templateId,
      name: completedWorkouts.name,
      completedAt: completedWorkouts.completedAt,
      startedAt: completedWorkouts.startedAt,
      durationSeconds: completedWorkouts.durationSeconds,
      calendarEventId: completedWorkouts.calendarEventId,
      routineInstanceId: completedWorkouts.routineInstanceId,
      routineDayIndex: completedWorkouts.routineDayIndex,
      totalSets: sql<number>`coalesce(${counts.totalSets}, 0)`,
      totalReps: sql<number>`coalesce(${counts.totalReps}, 0)`,
      exerciseIds: sql<string[]>`coalesce(${exerciseIds.ids}, '{}')`,
    })
    .from(completedWorkouts)
    .leftJoin(counts, eq(counts.completedWorkoutId, completedWorkouts.id))
    .leftJoin(exerciseIds, eq(exerciseIds.completedWorkoutId, completedWorkouts.id))
    .where(and(eq(completedWorkouts.userId, user.id)))
    .orderBy(desc(completedWorkouts.completedAt));

  return rows;
});
