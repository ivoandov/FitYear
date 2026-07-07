import { lbsToDisplay, type WeightUnit } from "@/lib/units";
import type { SetData } from "@/lib/workout-stats";

// Minimal shape the track defaults need from a completed workout. The real
// records carry much more; we only read completedAt + the inline exercises.
type CompletedForTrack = {
  completedAt: Date;
  exercises: Array<Record<string, unknown>>;
};

export interface LastRecorded {
  weight: number | null;
  reps: number | null;
  distance: number | null;
  time: number | null;
}

/**
 * The best set for an exercise from the most recent completed workout that
 * contained it. "Best" = highest weight, tie-broken by longest distance (so
 * distance/time exercises still surface a sensible last value). Weights stay in
 * lbs (DB units); the caller converts for display.
 */
export function getLastRecordedValues(
  completedWorkouts: CompletedForTrack[],
  exerciseId: string,
): LastRecorded | null {
  const sortedWorkouts = [...completedWorkouts].sort(
    (a, b) => b.completedAt.getTime() - a.completedAt.getTime(),
  );

  for (const workout of sortedWorkouts) {
    const exercise = workout.exercises.find(
      (ex) => (ex as { id?: string }).id === exerciseId,
    ) as { setsData?: Array<Record<string, number | null>> } | undefined;
    if (exercise?.setsData && exercise.setsData.length > 0) {
      const completedSets = exercise.setsData.filter((s) => s.completed);
      if (completedSets.length > 0) {
        const bestSet = completedSets.reduce((best, s) => {
          const sWeight = s.weight ?? 0;
          const bestWeight = best.weight ?? 0;
          const sDistance = s.distance ?? 0;
          const bestDistance = best.distance ?? 0;
          if (sWeight !== bestWeight) return sWeight > bestWeight ? s : best;
          return sDistance > bestDistance ? s : best;
        });
        return {
          weight: bestSet.weight ?? null,
          reps: bestSet.reps ?? null,
          distance: bestSet.distance ?? null,
          time: bestSet.time ?? null,
        };
      }
    }
  }
  return null;
}

/**
 * The starting set rows for an exercise on the track screen. Prefills the first
 * set from the exercise's last recorded values (converted to the display unit);
 * distance/time exercises default to 1 set, weight/reps to 3.
 */
export function getDefaultSets(
  completedWorkouts: CompletedForTrack[],
  weightUnit: WeightUnit,
  exerciseId?: string,
  exerciseType?: string,
): SetData[] {
  const lastValues = exerciseId
    ? getLastRecordedValues(completedWorkouts, exerciseId)
    : null;

  const isDistanceTime = exerciseType === "distance_time";

  if (lastValues) {
    const displayWeight = lbsToDisplay(lastValues.weight, weightUnit);
    if (isDistanceTime) {
      return [
        { setNumber: 1, weight: displayWeight, reps: lastValues.reps, distance: lastValues.distance, time: lastValues.time, completed: false },
      ];
    }
    return [
      { setNumber: 1, weight: displayWeight, reps: lastValues.reps, distance: lastValues.distance, time: lastValues.time, completed: false },
      { setNumber: 2, weight: null, reps: null, distance: null, time: null, completed: false },
      { setNumber: 3, weight: null, reps: null, distance: null, time: null, completed: false },
    ];
  }

  if (isDistanceTime) {
    return [
      { setNumber: 1, weight: null, reps: null, distance: null, time: null, completed: false },
    ];
  }
  return [
    { setNumber: 1, weight: null, reps: null, distance: null, time: null, completed: false },
    { setNumber: 2, weight: null, reps: null, distance: null, time: null, completed: false },
    { setNumber: 3, weight: null, reps: null, distance: null, time: null, completed: false },
  ];
}
