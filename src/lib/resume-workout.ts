import type { SetData } from "@/lib/workout-stats";

interface CompletedSetLike {
  setNumber?: number | null;
  weight?: number | null;
  reps?: number | null;
  distance?: number | null;
  time?: number | null;
  completed?: boolean;
}

export interface ResumableExercise {
  id?: string | null;
  name?: string | null;
  muscleGroups?: string[] | null;
  exerciseType?: string | null;
  isAssisted?: boolean | null;
  setsData?: CompletedSetLike[] | null;
}

/**
 * Rebuilds the tracking state of a workout that was already finished, so it can
 * be picked up where it stopped.
 *
 * Ivo, 2026-08-28: "It'd be cool to be able to fully pick up a workout later.
 * like pause it, or finish it but then allow the user to recontinue it, add to
 * it, and then finish it again with another summary that takes the two sessions
 * and adds them up."
 *
 * EVERY exercise comes back, including untouched ones - the point of resuming
 * is to do the part you did not get to. That is the opposite of repeating a
 * workout, which keeps only what was logged. Both readings are right for their
 * own action, so they are separate functions rather than one with a flag.
 *
 * Rows keep their `completed` flag exactly as stored: what you already logged
 * stays logged, and what you abandoned stays open for you to fill in.
 *
 * `instanceId` must be generated here and used for BOTH the exercise list and
 * the progress keys. Progress is keyed by instanceId, so a mismatch strands
 * every restored set - the app has already lost sets that way once.
 */
export function buildResumeState(
  exercises: ResumableExercise[] | null | undefined,
  displayId: string,
  stamp: number = Date.now(),
): {
  exercises: Array<Record<string, unknown>>;
  exerciseSets: [string, SetData[]][];
} {
  const list = Array.isArray(exercises) ? exercises : [];
  const outExercises: Array<Record<string, unknown>> = [];
  const outSets: [string, SetData[]][] = [];

  list.forEach((ex, index) => {
    if (!ex?.id) return;
    const instanceId = `${displayId}-${index}-${stamp}`;
    const stored = Array.isArray(ex.setsData) ? ex.setsData : [];

    // A resumed exercise with no rows still needs one to type into.
    const sets: SetData[] = (stored.length > 0 ? stored : [{ setNumber: 1 }]).map((s, i) => ({
      setNumber: s.setNumber ?? i + 1,
      weight: s.weight ?? null,
      reps: s.reps ?? null,
      distance: s.distance ?? null,
      time: s.time ?? null,
      completed: !!s.completed,
    }));

    outExercises.push({
      id: ex.id,
      instanceId,
      name: ex.name ?? "",
      muscleGroups: ex.muscleGroups ?? [],
      description: "",
      exerciseType: ex.exerciseType ?? "weight_reps",
      isAssisted: ex.isAssisted ?? false,
      sets: sets.length,
      defaultWeight: 0,
      defaultReps: 0,
      plannedLoadLbs: null,
    });
    outSets.push([instanceId, sets]);
  });

  return { exercises: outExercises, exerciseSets: outSets };
}

/**
 * Training time across both sittings.
 *
 * The gap BETWEEN them is not training - Ivo's example is coming back an hour
 * later - so the durations add rather than the clock running through the break.
 */
export function combinedDuration(
  previousSeconds: number | null | undefined,
  thisSessionSeconds: number | null | undefined,
): number {
  return Math.max(0, Math.round(previousSeconds ?? 0)) + Math.max(0, Math.round(thisSessionSeconds ?? 0));
}
