import { beatsHold, type BestHold } from "@/lib/workout-stats";

/**
 * All-time bests per exercise, for in-workout PR detection.
 *
 * Extracted from `usePrDetection`, which computed these by walking every set
 * the user had ever logged IN THE BROWSER - the reason the workout context, and
 * therefore every page in the app, had to carry the full history.
 * `/api/exercises/personal-bests` computes them server-side now, for just the
 * exercises in the workout being tracked.
 *
 * The rules are subtle enough that reimplementing them server-side would have
 * been a slow-motion bug, so both callers use these functions:
 *
 * - **An assisted exercise INVERTS the weight direction.** The weight column is
 *   counter-assistance, so LOWER is stronger, and volume is meaningless.
 * - **Zero-weight rows are excluded from weight and volume bests**, which is
 *   why a hold is scored separately: a bodyweight hang legitimately carries no
 *   load and could never register otherwise.
 * - **Completed sets only**, the rule every total in this app follows.
 */

export type BestRow = {
  exerciseId: string;
  exerciseType?: string | null;
  weight?: number | null;
  reps?: number | null;
  time?: number | null;
  completed?: boolean;
};

export type ExerciseBest = {
  bestWeight: number;
  maxVolume: number;
  assisted: boolean;
};

/** Weight and volume bests per exercise, in lbs (database units). */
export function computeHistoricalBests(
  rows: BestRow[],
  isAssistedById: Map<string, boolean>,
): Map<string, ExerciseBest> {
  const bests = new Map<string, ExerciseBest>();
  for (const s of rows) {
    if (!s.completed) continue;
    const wt = s.weight || 0;
    if (wt <= 0) continue; // zero-weight rows are the hold's business, not this
    const assisted = isAssistedById.get(s.exerciseId) === true;
    const cur = bests.get(s.exerciseId);
    if (!cur) {
      bests.set(s.exerciseId, {
        bestWeight: wt,
        maxVolume: assisted ? 0 : wt * (s.reps || 0),
        assisted,
      });
      continue;
    }
    if (assisted) {
      if (wt < cur.bestWeight) cur.bestWeight = wt;
    } else {
      if (wt > cur.bestWeight) cur.bestWeight = wt;
      const vol = wt * (s.reps || 0);
      if (vol > cur.maxVolume) cur.maxVolume = vol;
    }
  }
  return bests;
}

/**
 * Longest hold per exercise, with the load it was held at.
 *
 * Separate from the weight and volume bests because a hold's load can
 * legitimately be ZERO, which those discard.
 */
export function computeHistoricalHolds(
  rows: BestRow[],
  isHold: (exerciseType: string | null | undefined, exerciseId: string) => boolean,
): Map<string, BestHold> {
  const best = new Map<string, BestHold>();
  for (const s of rows) {
    if (!s.completed) continue;
    if (!isHold(s.exerciseType, s.exerciseId)) continue;
    const secs = s.time || 0;
    if (secs > 0 && beatsHold(secs, s.weight || 0, best.get(s.exerciseId))) {
      best.set(s.exerciseId, { seconds: secs, weightLbs: s.weight || 0 });
    }
  }
  return best;
}
