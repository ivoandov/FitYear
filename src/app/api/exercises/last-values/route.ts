import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  workoutExercises,
  workoutSets,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { pickLastRecorded, type LastRecorded, type LastSession } from "@/lib/track-helpers";
import { parseTimeZone } from "@/lib/api/timezone";
import { localDateKeyInZone } from "@/lib/date";
import type { NextRequest } from "next/server";

/**
 * What each exercise was last recorded at, for the tracker's prefill.
 *
 * This is the reason every page in the app was downloading every set the user
 * had ever logged. `getLastRecordedValues` walked the WHOLE completed-workout
 * list in the browser to answer one small question per exercise - "what did I
 * lift last time" - so the workout context had to hold all of it, on Home, on
 * History, everywhere.
 *
 * The question is answered here instead, for the handful of exercises in the
 * workout being tracked, in one query.
 *
 * The RANKING is deliberately not reimplemented: `pickLastRecorded` is the same
 * pure function the browser used, so the prefilled number cannot drift from
 * what it used to be.
 */
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();

  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    // A tracked workout holds a handful of exercises; the cap is a guard
    // against a crafted query asking for the whole catalog at once.
    .slice(0, 60);
  if (ids.length === 0) return {};

  // Newest first, so the first row seen per exercise comes from the most recent
  // workout that contained it - which is exactly what the old client-side walk
  // did after sorting.
  const rows = await db
    .select({
      exerciseId: workoutExercises.exerciseId,
      workoutId: completedWorkouts.id,
      workoutName: completedWorkouts.name,
      completedAt: completedWorkouts.completedAt,
      setNumber: workoutSets.setNumber,
      weightLbs: workoutSets.weightLbs,
      reps: workoutSets.reps,
      distance: workoutSets.distance,
      time: workoutSets.time,
      completed: workoutSets.completed,
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
        inArray(workoutExercises.exerciseId, ids),
        eq(workoutSets.completed, true),
      ),
    )
    // Newest workout first, and within it the sets in the order they were done,
    // which is the order the "last time" line reads them back.
    .orderBy(desc(completedWorkouts.completedAt), asc(workoutSets.setNumber));

  // Group by exercise, keeping only the sets from its most recent workout.
  const latest = new Map<
    string,
    {
      at: number;
      workoutId: string;
      workoutName: string;
      completedAt: Date;
      sets: Record<string, number | null>[];
    }
  >();
  for (const r of rows) {
    const at = r.completedAt.getTime();
    const entry = latest.get(r.exerciseId);
    if (!entry) {
      latest.set(r.exerciseId, {
        at,
        workoutId: r.workoutId,
        workoutName: r.workoutName,
        completedAt: r.completedAt,
        sets: [],
      });
    } else if (entry.workoutId !== r.workoutId) {
      // An older workout for an exercise we have already answered. Compared by
      // WORKOUT, not timestamp: two workouts finished in the same second would
      // otherwise merge into one "last session".
      continue;
    }
    latest.get(r.exerciseId)!.sets.push({
      weight: r.weightLbs,
      reps: r.reps,
      distance: r.distance,
      time: r.time,
      completed: 1,
    });
  }

  // The session's DAY is an instant resolved in the viewer's zone: an evening
  // workout is still the evening's, not tomorrow's in UTC.
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));
  const out: Record<string, LastRecorded> = {};
  for (const [exerciseId, entry] of latest) {
    const best = pickLastRecorded(entry.sets);
    if (!best) continue;
    const lastSession: LastSession = {
      date: localDateKeyInZone(entry.completedAt, tz),
      workoutName: entry.workoutName,
      sets: entry.sets.map((s) => ({
        weightLbs: s.weight ?? null,
        reps: s.reps ?? null,
        time: s.time ?? null,
        distance: s.distance ?? null,
      })),
    };
    out[exerciseId] = { ...best, lastSession };
  }
  return out;
});
