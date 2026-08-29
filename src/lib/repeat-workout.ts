import type { Exercise } from "@/data/exercises";
import { usesReps } from "@/lib/exercise-types";

interface CompletedSetLike {
  weight?: number | null;
  reps?: number | null;
  distance?: number | null;
  time?: number | null;
  completed?: boolean;
}

interface CompletedExerciseLike {
  id?: string | null;
  name?: string | null;
  muscleGroups?: string[] | null;
  exerciseType?: string | null;
  isAssisted?: boolean | null;
  setsData?: CompletedSetLike[] | null;
}

/**
 * Turns a workout you already did back into one you can start.
 *
 * Cori: "I can never find old workouts... I think also not all my workouts save
 * to library or show there?" Nothing did, because the Library only ever held
 * TEMPLATES, which are created deliberately, and finishing a workout never made
 * one. So there was no route from "I did this three weeks ago" to doing it
 * again.
 *
 * Only exercises with a COMPLETED set come across. Repeating a session you
 * abandoned half way should give you the half you actually did, not the plan
 * you walked away from - and an abandoned exercise carries prefilled rows that
 * look like data but are not.
 *
 * Set count and starting load come from what was really logged, so the repeat
 * begins where the last attempt ended rather than from a cold default.
 */
export function exercisesFromCompletedWorkout(
  exercises: CompletedExerciseLike[] | null | undefined,
): Exercise[] {
  if (!Array.isArray(exercises)) return [];
  const out: Exercise[] = [];

  for (const ex of exercises) {
    if (!ex?.id) continue;
    const done = (ex.setsData ?? []).filter((s) => s?.completed);
    if (done.length === 0) continue;

    // The last logged set is the best starting point: it is where the session
    // actually finished, after any warm-up ramp.
    const last = done[done.length - 1];
    out.push({
      id: ex.id,
      name: ex.name ?? "",
      muscleGroups: ex.muscleGroups ?? [],
      description: "",
      exerciseType: ex.exerciseType ?? "weight_reps",
      isAssisted: ex.isAssisted ?? false,
      sets: done.length,
      defaultWeight: last?.weight ?? 0,
      // A hold or a cardio bout has no reps to carry over.
      defaultReps: usesReps(ex.exerciseType) ? (last?.reps ?? 0) : 0,
    } as Exercise);
  }

  return out;
}
