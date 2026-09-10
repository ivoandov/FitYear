import { describe, it, expect } from "vitest";
import { parseRepsPrescription, formatTargetLine } from "@/lib/track-helpers";

/**
 * The Target line a routine day should produce.
 *
 * `startWorkout` used to hardcode `sets: 3` over whatever the program
 * prescribed, so a 5x5 opened as "3 sets x 5 reps" and Ivo could see a weight
 * target with a set count that was not his. These lock the reading rules the
 * fix depends on: the set count comes from the prescription, and the rep label
 * is shown VERBATIM rather than collapsed to a number.
 */
describe("a routine day's target line", () => {
  const planOf = (ex: { sets?: unknown; reps?: unknown; plannedSets?: number }) => {
    const prescription = parseRepsPrescription(ex.reps as string | number | null | undefined);
    const sets = ex.plannedSets ?? (typeof ex.sets === "number" ? ex.sets : undefined);
    return { sets, repsLabel: prescription.label, reps: prescription.prefillReps };
  };

  it("keeps the program's set count, not a hardcoded 3", () => {
    const plan = planOf({ sets: 5, reps: "5", plannedSets: 5 });
    expect(plan.sets).toBe(5);
    expect(formatTargetLine(plan)).toBe("5 sets x 5 reps");
  });

  it("shows a rep RANGE verbatim and prefills its low end", () => {
    const plan = planOf({ sets: 4, reps: "6-8", plannedSets: 4 });
    expect(formatTargetLine(plan)).toBe("4 sets x 6-8 reps");
    expect(plan.reps).toBe(6);
  });

  it("shows an unparseable prescription rather than dropping it", () => {
    const plan = planOf({ sets: 3, reps: "AMRAP", plannedSets: 3 });
    expect(formatTargetLine(plan)).toBe("3 sets x AMRAP reps");
    expect(plan.reps).toBeNull();
  });

  it("falls back to the historic default when there is no prescription", () => {
    // A quick-start or hand-made scheduled workout: no sets, no reps.
    const plan = planOf({});
    expect(plan.sets).toBeUndefined();
    expect(formatTargetLine(plan)).toBeNull();
  });
});
