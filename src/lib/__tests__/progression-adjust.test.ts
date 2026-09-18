import { describe, it, expect } from "vitest";
import { heldTarget, holdExercises, lowRepTarget, topSetsByExercise } from "@/lib/api/progression-adjust";

const RULE = { incrementLbs: 5, everyWeeks: 1 };

describe("reading a prescription's rep target", () => {
  it("takes the LOW end of a range", () => {
    // Only ever for comparison. Reps are a string by contract and are shown
    // verbatim; collapsing a range anywhere it is WRITTEN is the exact bug the
    // string type exists to prevent.
    expect(lowRepTarget("6-8")).toBe(6);
    expect(lowRepTarget("8")).toBe(8);
    expect(lowRepTarget(10)).toBe(10);
  });

  it("has no target for AMRAP", () => {
    // Nothing to fall short of, so nothing to hold for.
    expect(lowRepTarget("AMRAP")).toBeNull();
    expect(lowRepTarget("")).toBeNull();
    expect(lowRepTarget(null)).toBeNull();
  });

  it("does not read a TIME prescription as reps", () => {
    // "30s" is half a minute, not thirty reps. Treating it as reps would mark
    // every hold as a miss and freeze its progression forever.
    expect(lowRepTarget("30s")).toBeNull();
    expect(lowRepTarget("45 sec")).toBeNull();
    expect(lowRepTarget("2 min")).toBeNull();
  });
});

describe("finding the set a target is judged against", () => {
  it("takes the heaviest COMPLETED set", () => {
    const top = topSetsByExercise([
      { name: "Bench", weightLbs: 135, reps: 10, completed: true },
      { name: "Bench", weightLbs: 185, reps: 5, completed: true },
      { name: "Bench", weightLbs: 205, reps: 1, completed: false },
    ]);
    // The 205 was never completed. Rows are prefilled from history, so an
    // untouched row still carries weight and reps.
    expect(top.get("Bench")).toEqual({ weightLbs: 185, reps: 5 });
  });

  it("ignores an exercise with no completed set at all", () => {
    const top = topSetsByExercise([
      { name: "Row", weightLbs: 135, reps: 8, completed: false },
    ]);
    expect(top.has("Row")).toBe(false);
  });
});

describe("deciding whether to hold", () => {
  it("holds at what was LIFTED when the reps were missed", () => {
    // The bug this guards: an earlier draft passed the already-climbed load in
    // as the base, so the hold floored at the very weight it was meant to hold
    // below and nothing ever held.
    expect(heldTarget(195, RULE, { weightLbs: 190, reps: 5 }, 8)).toBe(190);
  });

  it("does not hold when the reps were hit", () => {
    expect(heldTarget(195, RULE, { weightLbs: 190, reps: 8 }, 8)).toBeNull();
    expect(heldTarget(195, RULE, { weightLbs: 190, reps: 12 }, 8)).toBeNull();
  });

  it("does not hold on a much lighter day", () => {
    // Missing reps at 135 says nothing about whether 195 is reachable.
    expect(heldTarget(195, RULE, { weightLbs: 135, reps: 3 }, 8)).toBeNull();
  });

  it("does not hold when there is no rep target", () => {
    expect(heldTarget(195, RULE, { weightLbs: 190, reps: 3 }, null)).toBeNull();
  });

  it("never prescribes MORE than the plan", () => {
    // Somebody who went heavier than prescribed and missed reps should repeat
    // the plan, not have their overreach written into the program.
    expect(heldTarget(195, RULE, { weightLbs: 225, reps: 2 }, 8)).toBeNull();
  });

  it("returns null rather than the same number when nothing changes", () => {
    // The caller only writes when something actually changed; returning the
    // planned value would rewrite every future session on every save.
    expect(heldTarget(195, RULE, { weightLbs: 195, reps: 5 }, 8)).toBeNull();
  });
});

describe("holding the next session, exercise by exercise", () => {
  // Bench prescribed 195 for 8, and the last session got 190 for 5.
  const next = [{ name: "Bench", targetLoadLbs: 195, reps: "8" }];
  const fellShort = [{ name: "Bench", weightLbs: 190, reps: 5, completed: true }];

  it("holds under the routine's rule", () => {
    expect(holdExercises(next, RULE, fellShort)).toEqual([
      { name: "Bench", targetLoadLbs: 190, reps: "8", progressionHeld: true },
    ]);
  });

  it("holds under an exercise's OWN rule when the routine has none", () => {
    // This is what the per-exercise override was missing: the caller resolved
    // only the routine default, found none, and nothing ever held.
    const own = [{ ...next[0], progression: { incrementLbs: 5, everyWeeks: 1 } }];
    const [out] = holdExercises(own, null, fellShort) ?? [];
    expect(out?.targetLoadLbs).toBe(190);
  });

  it("judges against the exercise's own increment, not the routine's", () => {
    // 150 lifted against a 195 plan: 45 short. Evidence under a +50 rule (the
    // shortfall is within one step), noise under the routine's +5.
    const own = [{ ...next[0], progression: { incrementLbs: 50, everyWeeks: 1 } }];
    const lighter = [{ name: "Bench", weightLbs: 150, reps: 5, completed: true }];
    expect(holdExercises(next, RULE, lighter)).toBeNull();
    expect(holdExercises(own, RULE, lighter)?.[0].targetLoadLbs).toBe(150);
  });

  it("leaves an assisted lift alone", () => {
    expect(holdExercises(next, RULE, fellShort, () => true)).toBeNull();
  });

  it("returns null when nothing changed, so nothing is written", () => {
    const hit = [{ name: "Bench", weightLbs: 195, reps: 8, completed: true }];
    expect(holdExercises(next, RULE, hit)).toBeNull();
    expect(holdExercises(next, null, fellShort)).toBeNull();
  });
});
