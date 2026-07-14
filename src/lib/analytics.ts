import { round1 } from "@/lib/units";

/**
 * Progressive-overload suggestion for the NEXT session of an exercise, derived
 * from the most recent session's top set. Deterministic double-progression:
 *
 *  - normal lift: if you hit >= `repThreshold` reps last time, add one load
 *    increment and hold the reps; otherwise add a rep at the same load (build
 *    reps first, then weight).
 *  - assisted lift (lower weight = harder, because "weight" is the counter-
 *    assistance): reduce the assistance by one increment (less help). If that
 *    would drop to <= 0, add a rep instead.
 *
 * Weights are in lbs (DB units); the display layer converts to the user's unit.
 * Pure + unit-tested so the exercise page can render it server-side.
 */

export interface OverloadInput {
  lastTopWeightLbs: number;
  lastReps: number;
  isAssisted: boolean;
  incrementLbs?: number; // default 5 lb (the app's default weight step)
  repThreshold?: number; // default 8: reps at/above which we add load
}

export type OverloadKind = "increase-weight" | "add-rep" | "reduce-assist";

export interface OverloadSuggestion {
  kind: OverloadKind;
  suggestedWeightLbs: number;
  suggestedReps: number;
  rationale: string;
}

export function overloadSuggestion(input: OverloadInput): OverloadSuggestion {
  const inc = input.incrementLbs ?? 5;
  const threshold = input.repThreshold ?? 8;
  const w = Math.max(0, input.lastTopWeightLbs);
  const r = Math.max(0, Math.round(input.lastReps));

  if (input.isAssisted) {
    if (w - inc > 0) {
      return {
        kind: "reduce-assist",
        suggestedWeightLbs: round1(w - inc),
        suggestedReps: r,
        rationale: `You held ${r} reps with more help last time. Drop the assistance a notch for a harder set.`,
      };
    }
    return {
      kind: "add-rep",
      suggestedWeightLbs: round1(w),
      suggestedReps: r + 1,
      rationale: `Almost unassisted. Add a rep before dropping the assistance further.`,
    };
  }

  if (r >= threshold) {
    return {
      kind: "increase-weight",
      suggestedWeightLbs: round1(w + inc),
      suggestedReps: r,
      rationale: `You hit ${r} reps last time. Add load and aim to hold the reps.`,
    };
  }
  return {
    kind: "add-rep",
    suggestedWeightLbs: round1(w),
    suggestedReps: r + 1,
    rationale: `Build to ${threshold}+ reps at this weight, then add load. Aim for ${r + 1} this session.`,
  };
}
