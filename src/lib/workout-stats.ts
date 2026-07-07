import type { CompletedWorkout } from "@/lib/db/schema";
import { localDateKey } from "@/lib/date";

export interface SetData {
  setNumber: number;
  weight: number | null;
  reps: number | null;
  distance: number | null;
  time: number | null;
  completed: boolean;
}

export interface ExerciseInWorkout {
  id: string;
  name: string;
  muscleGroups?: string[];
  setsData?: SetData[];
  completedSets?: number;
  sets?: number;
}

export interface WorkoutSummary {
  durationSeconds: number | null;
  totalSets: number;
  totalVolumeLbs: number;
  exerciseCount: number;
  muscleGroups: Map<string, number>; // muscleGroup → sets count
}

export function summarizeWorkout(
  workout: Pick<CompletedWorkout, "exercises" | "completedAt" | "startedAt" | "durationSeconds">,
): WorkoutSummary {
  const exercises = (workout.exercises as ExerciseInWorkout[]) || [];
  let totalSets = 0;
  let totalVolume = 0;
  const muscleGroups = new Map<string, number>();

  for (const ex of exercises) {
    const setsData = ex.setsData ?? [];
    const completedSets = setsData.filter((s) => s.completed);
    totalSets += completedSets.length;
    for (const s of completedSets) {
      totalVolume += (s.weight || 0) * (s.reps || 0);
    }
    if (ex.muscleGroups?.length && completedSets.length) {
      for (const mg of ex.muscleGroups) {
        muscleGroups.set(mg, (muscleGroups.get(mg) || 0) + completedSets.length);
      }
    }
  }

  const durationSeconds =
    workout.durationSeconds ??
    (workout.startedAt
      ? Math.max(
          0,
          Math.floor(
            (new Date(workout.completedAt).getTime() -
              new Date(workout.startedAt).getTime()) /
              1000,
          ),
        )
      : null);

  return {
    durationSeconds,
    totalSets,
    totalVolumeLbs: totalVolume,
    exerciseCount: exercises.length,
    muscleGroups,
  };
}

/**
 * Auto-generate a workout name from the muscle groups trained, e.g.
 * "Back & Biceps". Used when the user starts a workout without naming it
 * (the new quick-start flow). Ranks groups by completed-set count and joins
 * the top two with " & ". Falls back to mere presence (exercise has the group)
 * when no sets are completed yet, and returns "" when there's no muscle data
 * at all (caller substitutes a generic name like "Quick Workout").
 */
export function deriveWorkoutName(
  exercises: Pick<ExerciseInWorkout, "muscleGroups" | "setsData">[],
): string {
  const byCompleted = new Map<string, number>();
  const byPresence = new Map<string, number>();
  for (const ex of exercises) {
    const groups = ex.muscleGroups ?? [];
    if (!groups.length) continue;
    const completed = (ex.setsData ?? []).filter((s) => s.completed).length;
    for (const g of groups) {
      byPresence.set(g, (byPresence.get(g) ?? 0) + 1);
      if (completed > 0) byCompleted.set(g, (byCompleted.get(g) ?? 0) + completed);
    }
  }
  const source = byCompleted.size > 0 ? byCompleted : byPresence;
  // Map iteration + Array.sort are stable, so ties break by first occurrence.
  const top = [...source.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([group]) => group);
  return top.join(" & ");
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function calcStreak(completedAtList: Date[]): number {
  if (!completedAtList.length) return 0;
  // Bucket completed_at into local-date keys
  const days = new Set(completedAtList.map((d) => localDateKey(new Date(d))));
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const cursor = new Date(today);
    cursor.setDate(today.getDate() - i);
    const key = localDateKey(cursor);
    if (days.has(key)) {
      streak++;
    } else if (i === 0) {
      // Today doesn't count yet — keep checking yesterday
      continue;
    } else {
      break;
    }
  }
  return streak;
}

export interface PrHit {
  exerciseId: string;
  exerciseName: string;
  type: "weight" | "volume";
  newValue: number;
  previousValue: number | null;
}

/**
 * Detect PRs in `currentWorkout` versus the user's prior history.
 *
 * For normal exercises (isAssisted = false): higher weight + higher volume = PR.
 *
 * For assisted exercises (isAssisted = true — e.g. assisted pull-up machine):
 * lower weight = PR, because the "weight" is the counter-weight that's helping
 * you. Less help = harder lift. Volume PR is skipped for assisted (the formula
 * weight*reps no longer represents work done; mixing it with normal volume
 * PRs would give false positives every time someone reduced assistance).
 *
 * `isAssistedById` maps exercise id → isAssisted. Exercises not in the map
 * default to false (normal).
 */
export function detectPRs(
  currentWorkout: Pick<CompletedWorkout, "exercises">,
  priorWorkouts: Pick<CompletedWorkout, "exercises">[],
  isAssistedById: Map<string, boolean> = new Map(),
): PrHit[] {
  // For normal exercises we track MAX; for assisted we track MIN (over
  // non-zero weights only, since "0 lbs assist" is a degenerate seed value).
  const histBestWeight = new Map<string, number>(); // max OR min by mode
  const histMaxVolume = new Map<string, number>();

  for (const w of priorWorkouts) {
    const exs = (w.exercises as ExerciseInWorkout[]) || [];
    for (const ex of exs) {
      const assisted = isAssistedById.get(ex.id) === true;
      for (const s of ex.setsData ?? []) {
        if (!s.completed) continue;
        const wt = s.weight || 0;
        if (wt <= 0) continue; // ignore zero-weight rows for best-tracking
        const cur = histBestWeight.get(ex.id);
        if (assisted) {
          if (cur === undefined || wt < cur) histBestWeight.set(ex.id, wt);
        } else {
          if (cur === undefined || wt > cur) histBestWeight.set(ex.id, wt);
          const vol = wt * (s.reps || 0);
          const curMaxVol = histMaxVolume.get(ex.id) ?? 0;
          if (vol > curMaxVol) histMaxVolume.set(ex.id, vol);
        }
      }
    }
  }

  const hits: PrHit[] = [];
  const currentExs = (currentWorkout.exercises as ExerciseInWorkout[]) || [];
  for (const ex of currentExs) {
    const assisted = isAssistedById.get(ex.id) === true;
    let bestWt = assisted ? Number.POSITIVE_INFINITY : 0;
    let bestVol = 0;
    let anyWeighted = false;
    for (const s of ex.setsData ?? []) {
      if (!s.completed) continue;
      const wt = s.weight || 0;
      if (wt <= 0) continue;
      anyWeighted = true;
      if (assisted) {
        if (wt < bestWt) bestWt = wt;
      } else {
        if (wt > bestWt) bestWt = wt;
        const vol = wt * (s.reps || 0);
        if (vol > bestVol) bestVol = vol;
      }
    }
    if (!anyWeighted) continue;
    const prev = histBestWeight.get(ex.id);
    const prevWt = prev ?? null;
    const isWeightPr = assisted
      ? prev === undefined || bestWt < prev
      : prev === undefined || bestWt > prev;
    if (isWeightPr) {
      hits.push({
        exerciseId: ex.id,
        exerciseName: ex.name,
        type: "weight",
        newValue: bestWt,
        previousValue: prevWt,
      });
    }
    // Volume PR only meaningful for non-assisted exercises
    if (!assisted) {
      const prevVol = histMaxVolume.get(ex.id) ?? null;
      if (bestVol > 0 && (prevVol === null || bestVol > prevVol)) {
        hits.push({
          exerciseId: ex.id,
          exerciseName: ex.name,
          type: "volume",
          newValue: bestVol,
          previousValue: prevVol,
        });
      }
    }
  }
  return hits;
}
