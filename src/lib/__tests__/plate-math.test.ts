import { describe, it, expect } from "vitest";
import {
  solvePlates,
  warmupSets,
  formatPerSide,
  equipmentFor,
  DEFAULT_PLATES_LBS,
  DEFAULT_BAR_LBS,
  showsPlateMath,
} from "@/lib/plate-math";

const P = DEFAULT_PLATES_LBS;
const BAR = DEFAULT_BAR_LBS;

describe("solvePlates", () => {
  it("solves the everyday numbers", () => {
    expect(solvePlates(135, BAR, P).perSide).toEqual([45]);
    expect(solvePlates(225, BAR, P).perSide).toEqual([45, 45]);
    expect(solvePlates(315, BAR, P).perSide).toEqual([45, 45, 45]);
  });

  it("mixes denominations and reports the achievable total", () => {
    const plan = solvePlates(185, BAR, P);
    expect(plan.perSide).toEqual([45, 25]);
    expect(plan.achievable).toBe(185);
    expect(plan.approximate).toBe(false);
  });

  it("an empty bar is a legitimate answer, not an error", () => {
    const plan = solvePlates(45, BAR, P);
    expect(plan.perSide).toEqual([]);
    expect(plan.achievable).toBe(BAR);
    expect(formatPerSide(plan, "lbs")).toBe("empty bar");
  });

  it("says so when a target cannot be built", () => {
    // 46 lb: one pound over the bar, and the smallest pair adds five.
    const plan = solvePlates(46, BAR, P);
    expect(plan.approximate).toBe(true);
    expect(plan.achievable).toBe(BAR);
    expect(plan.shortfallOf).toBe(1);
  });

  it("never overshoots the target", () => {
    for (let target = 45; target <= 500; target += 2.5) {
      const plan = solvePlates(target, BAR, P);
      expect(plan.achievable).toBeLessThanOrEqual(target + 1e-6);
    }
  });

  it("hits every loadable target exactly, with no float drift", () => {
    // Plates load in PAIRS, so the smallest step off the bar is 5 lb, not 2.5.
    // The float trap this guards: subtracting 2.5 repeatedly leaves 2.4999...
    // and silently drops the last plate, landing a step light with no error.
    for (let target = 50; target <= 405; target += 5) {
      const plan = solvePlates(target, BAR, P);
      expect(plan.achievable).toBe(target);
      expect(plan.approximate).toBe(false);
    }
  });

  it("reports a half-step target as unbuildable rather than silently rounding", () => {
    // 52.5 needs 3.75 a side and the smallest plate is 2.5, so it cannot be
    // built. Saying "50, 2.5 short" is honest; rounding to 50 in silence is not.
    const plan = solvePlates(52.5, BAR, P);
    expect(plan.achievable).toBe(50);
    expect(plan.approximate).toBe(true);
    expect(plan.shortfallOf).toBe(2.5);
  });

  it("works in kilos with a kilo bar", () => {
    const { bar, plates } = equipmentFor("kg");
    expect(solvePlates(100, bar, plates).perSide).toEqual([25, 15]);
    expect(solvePlates(bar, bar, plates).perSide).toEqual([]);
  });

  it("treats a target below the bar as the bar", () => {
    const plan = solvePlates(20, BAR, P);
    expect(plan.perSide).toEqual([]);
    expect(plan.achievable).toBe(BAR);
  });
});

describe("formatPerSide", () => {
  it("collapses repeats", () => {
    expect(formatPerSide(solvePlates(315, BAR, P), "lbs")).toBe("45x3");
    expect(formatPerSide(solvePlates(185, BAR, P), "lbs")).toBe("45, 25");
  });
});

describe("warmupSets", () => {
  it("ramps with rising load and falling reps", () => {
    const sets = warmupSets(225, BAR, P);
    expect(sets.length).toBeGreaterThan(1);
    for (let i = 1; i < sets.length; i++) {
      expect(sets[i].weight).toBeGreaterThan(sets[i - 1].weight);
      expect(sets[i].reps).toBeLessThanOrEqual(sets[i - 1].reps);
    }
  });

  it("every rung is loadable and below the working weight", () => {
    const sets = warmupSets(225, BAR, P);
    for (const s of sets) {
      expect(solvePlates(s.weight, BAR, P).achievable).toBe(s.weight);
      expect(s.weight).toBeLessThan(225);
    }
  });

  it("gives nothing for a working weight at or below the bar", () => {
    expect(warmupSets(45, BAR, P)).toEqual([]);
    expect(warmupSets(30, BAR, P)).toEqual([]);
  });

  it("drops rungs that fall at or under the bar", () => {
    // 95 lb: 40% is 38, under the 45 lb bar, so that rung cannot exist. The
    // 60% and 80% rungs round down to 55 and 75 and both survive.
    const sets = warmupSets(95, BAR, P);
    expect(sets.map((s) => s.weight)).toEqual([55, 75]);
    expect(sets.every((s) => s.weight > BAR)).toBe(true);
  });

  it("drops duplicates left by rounding", () => {
    const sets = warmupSets(135, BAR, P);
    const weights = sets.map((s) => s.weight);
    expect(new Set(weights).size).toBe(weights.length);
  });

  it("renumbers after dropping rungs", () => {
    const sets = warmupSets(135, BAR, P);
    sets.forEach((s, i) => expect(s.index).toBe(i + 1));
  });
});

describe("showsPlateMath", () => {
  it("is on for a plain barbell lift", () => {
    expect(showsPlateMath("Barbell Bench Press", "weight_reps")).toBe(true);
    expect(showsPlateMath("BB Row", "weight_reps")).toBe(true);
  });

  it("is OFF for every bar whose empty weight we cannot assume", () => {
    // A hint computed from the wrong bar weight is wrong, not approximate.
    for (const n of ["EZ Bar Curl", "Trap Bar Deadlift", "Smith Machine Squat", "T Bar Row"]) {
      expect(showsPlateMath(n, "weight_reps")).toBe(false);
    }
  });

  it("is off for anything not loaded on a bar", () => {
    for (const n of ["Dumbbell Incline Bench Press", "Cable Rope Pushdowns", "Pull-ups", "Kettlebell Swing"]) {
      expect(showsPlateMath(n, "weight_reps")).toBe(false);
    }
  });

  it("is off for cardio, and on for a loaded barbell hold", () => {
    expect(showsPlateMath("Barbell Row", "distance_time")).toBe(false);
    expect(showsPlateMath("Barbell Hold", "weight_time")).toBe(true);
  });
});
