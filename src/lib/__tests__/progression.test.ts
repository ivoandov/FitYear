import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROGRESSION,
  describeRule,
  effectiveRule,
  normalizeRule,
  plannedLoadForWeek,
  progressedExercises,
  resolveTarget,
} from "@/lib/progression";

const FIVE_WEEKLY = { incrementLbs: 5, everyWeeks: 1 };
const FIVE_FORTNIGHTLY = { incrementLbs: 5, everyWeeks: 2 };

describe("planning a week's load", () => {
  it("starts at the base weight in week 1", () => {
    // Week 1 is the starting load, not the first increment. A scheme that
    // opened 5 lb above what the user entered would be prescribing a weight
    // they never chose.
    expect(plannedLoadForWeek(185, FIVE_WEEKLY, 1)).toBe(185);
  });

  it("climbs every week when everyWeeks is 1", () => {
    expect(plannedLoadForWeek(185, FIVE_WEEKLY, 2)).toBe(190);
    expect(plannedLoadForWeek(185, FIVE_WEEKLY, 5)).toBe(205);
  });

  it("holds each load for N weeks when everyWeeks is N", () => {
    // "Every 2 weeks" means two weeks AT each load, not a skipped week before
    // starting. Weeks 1-2 at base, 3-4 one step up.
    expect(plannedLoadForWeek(185, FIVE_FORTNIGHTLY, 1)).toBe(185);
    expect(plannedLoadForWeek(185, FIVE_FORTNIGHTLY, 2)).toBe(185);
    expect(plannedLoadForWeek(185, FIVE_FORTNIGHTLY, 3)).toBe(190);
    expect(plannedLoadForWeek(185, FIVE_FORTNIGHTLY, 4)).toBe(190);
    expect(plannedLoadForWeek(185, FIVE_FORTNIGHTLY, 5)).toBe(195);
  });

  it("never prescribes below the base for a nonsense week", () => {
    // A bad week number must not subtract load.
    expect(plannedLoadForWeek(185, FIVE_WEEKLY, 0)).toBe(185);
    expect(plannedLoadForWeek(185, FIVE_WEEKLY, -4)).toBe(185);
  });

  it("handles a fractional increment without drifting", () => {
    expect(plannedLoadForWeek(100, { incrementLbs: 2.5, everyWeeks: 1 }, 5)).toBe(110);
  });
});

describe("holding when the last session fell short", () => {
  const base = 185;

  it("honours the plan with no history at all", () => {
    // A first session has nothing to fall short of.
    const r = resolveTarget(base, FIVE_WEEKLY, 3, null);
    expect(r.loadLbs).toBe(195);
    expect(r.held).toBe(false);
  });

  it("honours the plan when the reps were hit", () => {
    const r = resolveTarget(base, FIVE_WEEKLY, 3, {
      topWeightLbs: 190,
      reps: 8,
      targetReps: 8,
    });
    expect(r.loadLbs).toBe(195);
    expect(r.held).toBe(false);
  });

  it("HOLDS when the reps were missed at the working load", () => {
    // The whole point: a plan that keeps adding weight to a lift somebody is
    // already failing is what makes linear progression collapse in week six.
    const r = resolveTarget(base, FIVE_WEEKLY, 3, {
      topWeightLbs: 190,
      reps: 5,
      targetReps: 8,
    });
    expect(r.held).toBe(true);
    expect(r.loadLbs).toBe(190);
    expect(r.reason).toContain("5 of 8");
  });

  it("ignores a shortfall on a much lighter set", () => {
    // Missing reps on a warm-up or a deliberately light day says nothing about
    // whether the next step up is reachable.
    const r = resolveTarget(base, FIVE_WEEKLY, 5, {
      topWeightLbs: 135,
      reps: 4,
      targetReps: 8,
    });
    expect(r.held).toBe(false);
    expect(r.loadLbs).toBe(205);
  });

  it("never prescribes BELOW the base weight", () => {
    // Holding repeats a week. It must not turn into a deload: a surprise drop
    // in prescribed weight reads as a bug, and one short session is not a
    // stall.
    const r = resolveTarget(base, FIVE_WEEKLY, 4, {
      topWeightLbs: 95,
      reps: 2,
      targetReps: 8,
    });
    expect(r.loadLbs).toBeGreaterThanOrEqual(base);
  });

  it("says nothing when the plan was not asking for a rep count", () => {
    // An AMRAP or a timed hold has no target to fall short of.
    const r = resolveTarget(base, FIVE_WEEKLY, 3, {
      topWeightLbs: 190,
      reps: 3,
      targetReps: null,
    });
    expect(r.held).toBe(false);
    expect(r.reason).toBeNull();
  });
});

describe("which rule applies", () => {
  it("prefers the exercise's own rule over the routine default", () => {
    const r = effectiveRule(FIVE_WEEKLY, { incrementLbs: 10, everyWeeks: 2 });
    expect(r).toEqual({ incrementLbs: 10, everyWeeks: 2 });
  });

  it("takes the override WHOLE, never merging the two", () => {
    // A half-inherited rule - this exercise's increment, the routine's
    // frequency - would be a scheme nobody chose. 5 lb on a bench is a
    // different ask from 5 lb on a squat.
    const r = effectiveRule({ incrementLbs: 5, everyWeeks: 3 }, { incrementLbs: 10 });
    expect(r).toEqual({ incrementLbs: 10, everyWeeks: 1 });
  });

  it("falls back to the routine default when the exercise has none", () => {
    expect(effectiveRule(FIVE_FORTNIGHTLY, null)).toEqual(FIVE_FORTNIGHTLY);
    expect(effectiveRule(FIVE_FORTNIGHTLY, {})).toEqual(FIVE_FORTNIGHTLY);
  });

  it("is null when neither level sets one", () => {
    // No progression is a legitimate state, and it must not silently become
    // the default: adding weight to somebody's routine uninvited is worse than
    // doing nothing.
    expect(effectiveRule(null, null)).toBeNull();
  });
});

describe("normalising a rule from a browser or a model", () => {
  it("clamps an absurd increment rather than rejecting the routine", () => {
    expect(normalizeRule({ incrementLbs: 9999, everyWeeks: 1 })?.incrementLbs).toBe(100);
    expect(normalizeRule({ incrementLbs: 0.01, everyWeeks: 1 })?.incrementLbs).toBe(0.5);
  });

  it("clamps the frequency to a year", () => {
    expect(normalizeRule({ incrementLbs: 5, everyWeeks: 999 })?.everyWeeks).toBe(52);
    expect(normalizeRule({ incrementLbs: 5, everyWeeks: 0 })?.everyWeeks).toBe(1);
  });

  it("rejects a rule with no usable increment", () => {
    expect(normalizeRule({ incrementLbs: 0, everyWeeks: 1 })).toBeNull();
    expect(normalizeRule({ incrementLbs: -5, everyWeeks: 1 })).toBeNull();
    expect(normalizeRule({ incrementLbs: "heavy", everyWeeks: 1 })).toBeNull();
    expect(normalizeRule(null)).toBeNull();
  });

  it("defaults the frequency to weekly when it is missing", () => {
    expect(normalizeRule({ incrementLbs: 5 })?.everyWeeks).toBe(1);
  });
});

describe("telling the user what the plan is", () => {
  it("reads naturally for both frequencies", () => {
    expect(describeRule(FIVE_WEEKLY)).toBe("+5 lb every week");
    expect(describeRule(FIVE_FORTNIGHTLY)).toBe("+5 lb every 2 weeks");
  });

  it("does not print a trailing .0 on a whole number", () => {
    expect(describeRule({ incrementLbs: 10, everyWeeks: 1 })).toBe("+10 lb every week");
    expect(describeRule({ incrementLbs: 2.5, everyWeeks: 1 })).toBe("+2.5 lb every week");
  });

  it("says nothing when there is no rule", () => {
    expect(describeRule(null)).toBeNull();
  });

  it("describes the shipped default", () => {
    expect(describeRule(DEFAULT_PROGRESSION)).toBe("+5 lb every week");
  });
});

describe("baking a session's targets", () => {
  const bench = { name: "Bench", targetLoadLbs: 135, reps: "5" };

  it("climbs a starting weight by the routine's rule", () => {
    expect(progressedExercises([bench], FIVE_WEEKLY, 3)).toEqual([
      { ...bench, targetLoadLbs: 145 },
    ]);
  });

  it("uses an exercise's own rule INSTEAD of the routine's, not merged with it", () => {
    // +10 every 2 weeks on the exercise, +5 weekly on the routine: week 3 is
    // one step of the exercise's rule. A merge would give 140 or 155.
    const own = { ...bench, progression: { incrementLbs: 10, everyWeeks: 2 } };
    const [out] = progressedExercises([own], FIVE_WEEKLY, 3) as Array<Record<string, unknown>>;
    expect(out.targetLoadLbs).toBe(145);
  });

  it("climbs an exercise with its own rule when the routine has none", () => {
    // The manual path this build exists for: the routine rule is off and one
    // lift carries its own.
    const own = { ...bench, progression: { incrementLbs: 5, everyWeeks: 1 } };
    const [out] = progressedExercises([own], null, 2) as Array<Record<string, unknown>>;
    expect(out.targetLoadLbs).toBe(140);
  });

  it("leaves an exercise with no starting weight alone", () => {
    // Inventing a first weight for somebody is a guess, not a calculation.
    const bare = { name: "Row", reps: "8" };
    expect(progressedExercises([bare], FIVE_WEEKLY, 4)).toEqual([bare]);
    const zero = { name: "Push-ups", targetLoadLbs: 0 };
    expect(progressedExercises([zero], FIVE_WEEKLY, 4)).toEqual([zero]);
  });

  it("never climbs an ASSISTED lift", () => {
    // Its weight is assistance. +5 lb a week would make it easier every week.
    const assisted = { name: "Assisted Pull-ups", targetLoadLbs: 60 };
    const out = progressedExercises([assisted, bench], FIVE_WEEKLY, 3, (ex) => ex.name === "Assisted Pull-ups");
    expect(out).toEqual([assisted, { ...bench, targetLoadLbs: 145 }]);
  });

  it("does nothing when neither level has a rule", () => {
    expect(progressedExercises([bench], null, 6)).toEqual([bench]);
  });

  it("treats a missing exercise list as empty", () => {
    expect(progressedExercises(null, FIVE_WEEKLY, 1)).toEqual([]);
  });
});
