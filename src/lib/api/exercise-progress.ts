import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { completedWorkouts, workoutExercises } from "@/lib/db/schema";
import { assembleNormalizedExercises } from "@/lib/db/normalized-workout";
import { localDateKeyInZone } from "@/lib/date";
import { epley1RM } from "@/lib/workout-stats";
import type { ProgressPoint } from "@/components/ExerciseProgressChart";

/**
 * One exercise's history as chart points, for the exercise page AND the
 * tracker's trend sheet.
 *
 * Moved here from `app/(app)/exercises/[id]/page.tsx` on 2026-09-30 so the two
 * cannot drift. The body is the page's own code, not a rewrite: each set's
 * `setIdx` is its position in the ASSEMBLED sets, which is what the chart's
 * fix-a-set-weight action sends back, and reimplementing that enumeration is
 * exactly the kind of change that silently fixes the wrong set. What changed is
 * only WHICH workouts are loaded - the ones containing the exercise, not all.
 *
 * Every rule below was already here and still applies: completed sets only,
 * zero-weight and zero-rep sets excluded, the assisted inversion (a lighter
 * assist is stronger, and volume and est-1RM are meaningless for it), local
 * calendar days in the VIEWER's zone, and the 50%-of-median outlier flag.
 */

type ExerciseInWorkoutJson = {
  id: string;
  name?: string;
  setsData?: Array<{
    weight?: number | null;
    reps?: number | null;
    completed?: boolean;
  }>;
};

export async function loadExerciseProgress(
  userId: string,
  id: string,
  opts: { isAssisted: boolean; timeZone: string },
): Promise<ProgressPoint[]> {
  const { isAssisted, timeZone } = opts;
  // ONLY the workouts that contain the exercise. The page used to read every
  // workout the user ever logged and filter in memory, which was fine for one
  // page and is not for a chart opened mid-set from the tracker.
  const workouts = await db
    .selectDistinct({
      id: completedWorkouts.id,
      name: completedWorkouts.name,
      completedAt: completedWorkouts.completedAt,
    })
    .from(completedWorkouts)
    .innerJoin(
      workoutExercises,
      eq(workoutExercises.completedWorkoutId, completedWorkouts.id),
    )
    .where(
      and(
        eq(completedWorkouts.userId, userId),
        eq(workoutExercises.exerciseId, id),
      ),
    )
    .orderBy(desc(completedWorkouts.completedAt));

  // Phase 4d: assemble the per-set data from the normalized tables (sole store).
  // The enumeration index over the assembled sets (in set_number order) is what
  // the fix-set-weight endpoint expects as setIdx.
  const normalized = await assembleNormalizedExercises(workouts.map((w) => w.id));

  const points: ProgressPoint[] = [];
  for (const w of workouts) {
    const exs = (normalized.get(w.id) ?? []) as ExerciseInWorkoutJson[];
    const match = exs.find((e) => e.id === id);
    if (!match?.setsData) continue;
    const completedSets = match.setsData
      .map((s, idx) => ({
        setIdx: idx,
        weight: s.weight ?? 0,
        reps: s.reps ?? 0,
        completed: !!s.completed,
      }))
      .filter((s) => s.completed && s.weight > 0 && s.reps > 0);
    if (completedSets.length === 0) continue;
    // On an assisted lift "weight" is counter-assistance, so LOWER is stronger:
    // the best set is the lightest assist, and volume / est-1RM are meaningless
    // (same rule detectPRs and the records card already follow). Taking the max
    // here reported the user's easiest set as their heaviest.
    let bestWeight = isAssisted ? Number.POSITIVE_INFINITY : 0;
    let bestVolume = 0;
    let best1RM = 0;
    for (const s of completedSets) {
      if (isAssisted ? s.weight < bestWeight : s.weight > bestWeight) {
        bestWeight = s.weight;
      }
      if (!isAssisted) {
        const v = s.weight * s.reps;
        if (v > bestVolume) bestVolume = v;
        const e = epley1RM(s.weight, s.reps);
        if (e > best1RM) best1RM = e;
      }
    }
    if (!Number.isFinite(bestWeight)) bestWeight = 0;
    // Bucket by local calendar day (the app-wide convention, matching
    // calcStreak) instead of a UTC slice, which shifted late-evening workouts
    // into the next day and made the chart disagree with the streak.
    const dateStr = localDateKeyInZone(w.completedAt, timeZone);
    points.push({
      workoutId: w.id,
      workoutName: w.name,
      date: dateStr,
      bestWeightLbs: bestWeight,
      bestVolumeLbs: bestVolume,
      best1RMLbs: best1RM,
      sets: completedSets.map((s) => ({
        setIdx: s.setIdx,
        weightLbs: s.weight,
        reps: s.reps,
      })),
      isOutlier: false, // computed below once we know the median
    });
  }
  // Chart wants chronological order; the DB query was DESC for stat-strip uses
  points.sort((a, b) => a.date.localeCompare(b.date));

  // Outlier: median 1RM, flag anything < 50% of it (matches the audit script
  // heuristic, surfaced visually here for self-serve detection + fix).
  const sorted1RMs = points.map((p) => p.best1RMLbs).sort((a, b) => a - b);
  const median1RM =
    sorted1RMs.length === 0
      ? 0
      : sorted1RMs.length % 2
        ? sorted1RMs[sorted1RMs.length >>> 1]
        : (sorted1RMs[sorted1RMs.length / 2 - 1] +
            sorted1RMs[sorted1RMs.length / 2]) /
          2;
  for (const p of points) {
    p.isOutlier = median1RM > 0 && p.best1RMLbs < median1RM * 0.5;
  }

  return points;
}
