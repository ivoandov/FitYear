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

/**
 * Consistency summary for the Insights screen, derived from the per-day
 * completed-workout counts returned by GET /api/analytics/consistency (oldest
 * day first, newest last). Days are binned into trailing 7-day weeks from the
 * most-recent day backwards (index 0 = the current week), so the numbers don't
 * depend on calendar-week alignment and never read 0 just because today is a
 * rest day. Pure + unit-tested.
 */
export interface DayCount {
  day: string; // "YYYY-MM-DD"
  workouts: number;
}

export interface ConsistencySummary {
  totalWorkouts: number;
  activeDays: number;
  totalWeeks: number;
  weeksTrained: number;
  currentWeekStreak: number; // consecutive most-recent weeks with >= 1 workout
}

export function consistencySummary(days: DayCount[]): ConsistencySummary {
  const n = days.length;
  const totalWorkouts = days.reduce((a, d) => a + Math.max(0, d.workouts), 0);
  const activeDays = days.filter((d) => d.workouts > 0).length;
  const totalWeeks = Math.max(1, Math.ceil(n / 7));
  // index 0 = the most-recent trailing week
  const weekActive: boolean[] = Array(totalWeeks).fill(false);
  for (let i = 0; i < n; i++) {
    if (days[i].workouts > 0) {
      const wk = Math.floor((n - 1 - i) / 7);
      weekActive[wk] = true;
    }
  }
  const weeksTrained = weekActive.filter(Boolean).length;
  let currentWeekStreak = 0;
  for (const active of weekActive) {
    if (active) currentWeekStreak++;
    else break;
  }
  return { totalWorkouts, activeDays, totalWeeks, weeksTrained, currentWeekStreak };
}
