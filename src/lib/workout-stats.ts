import type { CompletedWorkout } from "@/lib/db/schema";

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
  // Bucket completed_at into local-date strings, sort descending
  const days = new Set(
    completedAtList.map((d) => {
      const x = new Date(d);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    }),
  );
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const cursor = new Date(today);
    cursor.setDate(today.getDate() - i);
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
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
 * Compares each completed set's weight (max across the workout per exercise)
 * and best volume (max weight × reps) to the historical best for that
 * exerciseId across all priorWorkouts.
 */
export function detectPRs(
  currentWorkout: Pick<CompletedWorkout, "exercises">,
  priorWorkouts: Pick<CompletedWorkout, "exercises">[],
): PrHit[] {
  const histMaxWeight = new Map<string, number>();
  const histMaxVolume = new Map<string, number>();

  for (const w of priorWorkouts) {
    const exs = (w.exercises as ExerciseInWorkout[]) || [];
    for (const ex of exs) {
      for (const s of ex.setsData ?? []) {
        if (!s.completed) continue;
        const wt = s.weight || 0;
        const vol = wt * (s.reps || 0);
        const curMaxWt = histMaxWeight.get(ex.id) ?? 0;
        if (wt > curMaxWt) histMaxWeight.set(ex.id, wt);
        const curMaxVol = histMaxVolume.get(ex.id) ?? 0;
        if (vol > curMaxVol) histMaxVolume.set(ex.id, vol);
      }
    }
  }

  const hits: PrHit[] = [];
  const currentExs = (currentWorkout.exercises as ExerciseInWorkout[]) || [];
  for (const ex of currentExs) {
    let bestWt = 0;
    let bestVol = 0;
    for (const s of ex.setsData ?? []) {
      if (!s.completed) continue;
      const wt = s.weight || 0;
      const vol = wt * (s.reps || 0);
      if (wt > bestWt) bestWt = wt;
      if (vol > bestVol) bestVol = vol;
    }
    const prevWt = histMaxWeight.get(ex.id) ?? null;
    const prevVol = histMaxVolume.get(ex.id) ?? null;
    if (bestWt > 0 && (prevWt === null || bestWt > prevWt)) {
      hits.push({
        exerciseId: ex.id,
        exerciseName: ex.name,
        type: "weight",
        newValue: bestWt,
        previousValue: prevWt,
      });
    }
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
  return hits;
}
