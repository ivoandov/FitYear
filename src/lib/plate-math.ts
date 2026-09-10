/**
 * What to put on the bar, and how to work up to it.
 *
 * Both of these are pure arithmetic with no server and no schema, which is why
 * they are together: the warm-up ramp is expressed in loads, and every load it
 * produces has to be LOADABLE, so it needs the plate solver to round to
 * something you can actually build.
 */

import { lbsToDisplay, type WeightUnit } from "@/lib/units";
import { detectEquipment } from "@/lib/exercise-naming";

/** A standard pair-loaded gym set, heaviest first. Pounds. */
export const DEFAULT_PLATES_LBS = [45, 35, 25, 10, 5, 2.5] as const;
/** Kilo gyms. Used when the display unit is kg so the numbers are the real ones. */
export const DEFAULT_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;
export const DEFAULT_BAR_LBS = 45;
export const DEFAULT_BAR_KG = 20;

export interface PlatePlan {
  /** Plates for ONE side, heaviest first. The other side mirrors it. */
  perSide: number[];
  /** What the bar actually weighs once loaded. */
  achievable: number;
  /** Target minus achievable. Zero when the target is exactly loadable. */
  shortfallOf: number;
  /** True when the target cannot be built from the available plates. */
  approximate: boolean;
}

/**
 * Greedy from the heaviest plate down, which is optimal for a real plate set
 * because each denomination is a multiple of the ones below it. It stays
 * correct for odd sets too, just not provably minimal, and nobody has ever
 * cared about minimality while standing at a rack.
 */
export function solvePlates(
  targetWeight: number,
  barWeight: number,
  plates: readonly number[],
): PlatePlan {
  const empty: PlatePlan = { perSide: [], achievable: barWeight, shortfallOf: 0, approximate: false };
  if (!Number.isFinite(targetWeight) || !Number.isFinite(barWeight)) return empty;
  // A target at or under the bar is just the bar. Not an error - an empty
  // barbell is a legitimate warm-up set.
  if (targetWeight <= barWeight) {
    return { ...empty, shortfallOf: Math.max(0, targetWeight - barWeight) };
  }

  // Everything is loaded in PAIRS, so solve one side against half the load.
  let remainingPerSide = (targetWeight - barWeight) / 2;
  const perSide: number[] = [];
  const sorted = [...plates].sort((a, b) => b - a);
  for (const plate of sorted) {
    // A tiny epsilon: 2.5 + 2.5 + 2.5 accumulates float error, and being a
    // hundredth of a pound short must not cost you a plate.
    while (remainingPerSide >= plate - 1e-6) {
      perSide.push(plate);
      remainingPerSide -= plate;
    }
  }
  const achievable = barWeight + perSide.reduce((n, p) => n + p, 0) * 2;
  const shortfallOf = Math.round((targetWeight - achievable) * 100) / 100;
  return { perSide, achievable, shortfallOf, approximate: Math.abs(shortfallOf) > 1e-6 };
}

/** "45, 25, 10" - one side, for the pill under the weight input. */
export function formatPerSide(plan: PlatePlan, unit: WeightUnit): string {
  if (!plan.perSide.length) return unit === "kg" ? "empty bar" : "empty bar";
  const counts = new Map<number, number>();
  for (const p of plan.perSide) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()]
    .map(([plate, n]) => (n > 1 ? `${plate}x${n}` : `${plate}`))
    .join(", ");
}

export interface WarmupSet {
  /** 1-indexed, counting up to but NOT including the working set. */
  index: number;
  /** Loadable weight for this rung. */
  weight: number;
  reps: number;
  /** Percentage of the working weight this rung represents, for display. */
  percent: number;
}

/**
 * A warm-up ramp to a working weight.
 *
 * The shape is the one every strength coach writes by hand: a few rungs at
 * rising percentages with FALLING reps, so you groove the movement without
 * spending the session's energy before the working sets. Percentages are
 * 40/60/80 of the working weight, which is unremarkable on purpose.
 *
 * Two rules make it useful rather than merely arithmetic:
 *  - every rung is rounded DOWN to something loadable, because a warm-up you
 *    cannot build is worse than one that is five pounds light;
 *  - rungs at or below the bar, and duplicates after rounding, are dropped. A
 *    95 lb working set does not need three warm-ups, it needs the bar.
 */
export function warmupSets(
  workingWeight: number,
  barWeight: number,
  plates: readonly number[],
): WarmupSet[] {
  if (!Number.isFinite(workingWeight) || workingWeight <= barWeight) return [];
  const rungs: { percent: number; reps: number }[] = [
    { percent: 0.4, reps: 8 },
    { percent: 0.6, reps: 5 },
    { percent: 0.8, reps: 3 },
  ];
  const out: WarmupSet[] = [];
  const seen = new Set<number>();
  for (const rung of rungs) {
    const raw = workingWeight * rung.percent;
    if (raw <= barWeight) continue;
    const plan = solvePlates(raw, barWeight, plates);
    // Round DOWN: solvePlates is greedy so `achievable` never exceeds the
    // target, which is the behavior we want for a warm-up.
    const weight = plan.achievable;
    if (weight >= workingWeight) continue;
    if (seen.has(weight)) continue;
    seen.add(weight);
    out.push({ index: out.length + 1, weight, reps: rung.reps, percent: Math.round(rung.percent * 100) });
  }
  return out;
}

/** Bar and plate set for a display unit. The numbers people actually see. */
export function equipmentFor(unit: WeightUnit): { bar: number; plates: readonly number[] } {
  return unit === "kg"
    ? { bar: DEFAULT_BAR_KG, plates: DEFAULT_PLATES_KG }
    : { bar: DEFAULT_BAR_LBS, plates: DEFAULT_PLATES_LBS };
}

/** Convenience for callers holding lbs but displaying kg. */
export function toDisplay(lbs: number, unit: WeightUnit): number {
  return lbsToDisplay(lbs, unit) ?? lbs;
}


/**
 * Whether a plate breakdown means anything for this exercise.
 *
 * DELIBERATELY narrow: a plain barbell only. Every other bar has a different
 * empty weight - an EZ bar is nearer 25 lb, a trap bar 45 to 60, a Smith
 * carriage anywhere from 15 to 45 depending on the machine - and a plate hint
 * computed from the wrong bar weight is not a smaller version of right, it is
 * simply wrong, on a screen where somebody is about to load a bar. Absent beats
 * wrong. Widen this only alongside a way to tell the app what your bar weighs.
 */
export function showsPlateMath(exerciseName: string, exerciseType?: string | null): boolean {
  if (exerciseType && exerciseType !== "weight_reps" && exerciseType !== "weight_time") return false;
  return detectEquipment(exerciseName) === "Barbell";
}
