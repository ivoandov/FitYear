import { NextRequest } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  exerciseGoals,
  workoutExercises,
  workoutSets,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { countsTowardGoal } from "@/lib/exercise-family";

/**
 * Reps logged toward each goal, so the tracker can show a live counter without
 * downloading the user's whole history.
 *
 * The History page computes this in the browser because it already holds every
 * completed workout for its other panels. The tracker holds none of that and
 * has no business fetching it mid-workout, which is why this exists.
 *
 * Matching goes through `countsTowardGoal`, the same module the History page
 * uses, so the number on the tracker and the number on the goals card cannot
 * disagree - which they would within a month if this re-implemented the rule.
 */

/** The rolling window a weekly goal is measured over. */
const WINDOW_DAYS = 7;

export const GET = handle(async (_request: NextRequest) => {
  const { user } = await requireUser();

  const goals = await db
    .select()
    .from(exerciseGoals)
    .where(eq(exerciseGoals.userId, user.id));
  if (goals.length === 0) return [];

  const since = new Date();
  since.setDate(since.getDate() - WINDOW_DAYS);
  since.setHours(0, 0, 0, 0);

  // Every completed set in the window, with the name it was logged under. The
  // NAME is what the family rule reads, and history keeps its own snapshot, so
  // this deliberately does not join back to the live catalog.
  const rows = await db
    .select({
      exerciseId: workoutExercises.exerciseId,
      name: workoutExercises.nameSnapshot,
      reps: workoutSets.reps,
      completedAt: completedWorkouts.completedAt,
    })
    .from(workoutExercises)
    .innerJoin(workoutSets, eq(workoutSets.workoutExerciseId, workoutExercises.id))
    .innerJoin(
      completedWorkouts,
      eq(completedWorkouts.id, workoutExercises.completedWorkoutId),
    )
    .where(
      and(
        eq(completedWorkouts.userId, user.id),
        eq(workoutSets.completed, true),
        gte(completedWorkouts.completedAt, since),
        sql`${workoutSets.reps} is not null`,
      ),
    );

  return goals.map((goal) => {
    let reps = 0;
    for (const r of rows) {
      if (!r.name) continue;
      if (!countsTowardGoal(goal, { id: r.exerciseId, name: r.name })) continue;
      reps += r.reps ?? 0;
    }
    return {
      goalId: goal.id,
      exerciseId: goal.exerciseId,
      exerciseName: goal.exerciseName,
      targetReps: goal.targetReps,
      repsThisWeek: reps,
    };
  });
});
