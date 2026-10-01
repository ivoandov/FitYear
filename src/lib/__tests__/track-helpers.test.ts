import { describe, it, expect } from "vitest";
import {
  formatTargetLine,
  getDefaultSets,
  getLastRecordedValues,
  parseRepsPrescription,
} from "@/lib/track-helpers";

const mk = (completedAt: string, exercises: unknown[]) => ({
  completedAt: new Date(completedAt),
  exercises: exercises as Array<Record<string, unknown>>,
});

describe("getLastRecordedValues", () => {
  it("returns null when the exercise was never completed", () => {
    expect(getLastRecordedValues([], "ex1")).toBeNull();
    const w = mk("2026-07-01", [{ id: "ex1", setsData: [{ weight: 100, reps: 5, completed: false }] }]);
    expect(getLastRecordedValues([w], "ex1")).toBeNull();
  });

  it("picks the most recent workout, then the heaviest completed set", () => {
    const older = mk("2026-07-01", [{ id: "ex1", setsData: [{ weight: 200, reps: 3, completed: true }] }]);
    const newer = mk("2026-07-05", [
      { id: "ex1", setsData: [
        { weight: 100, reps: 5, completed: true },
        { weight: 135, reps: 4, completed: true },
      ] },
    ]);
    // newer wins over older even though older is heavier; within newer, 135 > 100
    expect(getLastRecordedValues([older, newer], "ex1")).toMatchObject({ weight: 135, reps: 4 });
  });

  it("tie-breaks equal weight by longest distance", () => {
    const w = mk("2026-07-05", [
      { id: "ex1", setsData: [
        { weight: 0, distance: 1, time: 10, completed: true },
        { weight: 0, distance: 3, time: 30, completed: true },
      ] },
    ]);
    expect(getLastRecordedValues([w], "ex1")).toMatchObject({ distance: 3, time: 30 });
  });
});

describe("getDefaultSets", () => {
  it("defaults to 3 empty sets for weight_reps with no history", () => {
    const sets = getDefaultSets(null, "lbs", "weight_reps");
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.weight === null)).toBe(true);
  });

  it("defaults to 1 empty set for distance_time with no history", () => {
    expect(getDefaultSets(null, "lbs", "distance_time")).toHaveLength(1);
  });

  it("prefills the first set from history, converting to the display unit", () => {
    const lbs = getDefaultSets({ weight: 135, reps: 5, distance: null, time: null }, "lbs", "weight_reps");
    expect(lbs[0].weight).toBe(135);
    const kg = getDefaultSets({ weight: 135, reps: 5, distance: null, time: null }, "kg", "weight_reps");
    expect(kg[0].weight).toBe(61.2); // 135 lbs -> kg, 1 decimal
    expect(kg[0].reps).toBe(5);
  });
});

describe("getDefaultSets - with a FitBot plan", () => {
  const hist = mk("2026-07-05", [
    { id: "sq", setsData: [{ weight: 135, reps: 5, completed: true }] },
  ]);

  it("uses the plan's set count for the number of rows", () => {
    expect(getDefaultSets(null, "lbs", "weight_reps", { sets: 4, reps: 12 })).toHaveLength(4);
  });

  it("prefills the first row's reps from the plan when there is no history", () => {
    const rows = getDefaultSets(null, "lbs", "weight_reps", { sets: 4, reps: 12 });
    expect(rows[0]).toMatchObject({ reps: 12, weight: null });
    expect(rows.slice(1).every((r) => r.reps === null)).toBe(true);
  });

  it("leaves reps blank for an AMRAP-style plan (null target)", () => {
    const rows = getDefaultSets(null, "lbs", "weight_reps", { sets: 3, reps: null });
    expect(rows.every((r) => r.reps === null)).toBe(true);
  });

  it("honours the plan set count for distance/time but never prefills reps", () => {
    const rows = getDefaultSets(null, "lbs", "distance_time", { sets: 3, reps: 30 });
    expect(rows).toHaveLength(3);
    expect(rows[0].reps).toBeNull();
  });

  it("lets recorded history win on the first row while the plan still sets the count", () => {
    const rows = getDefaultSets({ weight: 135, reps: 5, distance: null, time: null }, "lbs", "weight_reps", { sets: 5, reps: 8 });
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ weight: 135, reps: 5 });
  });

  it("clamps a zero/negative plan count to at least one row", () => {
    expect(getDefaultSets(null, "lbs", "weight_reps", { sets: 0 })).toHaveLength(1);
  });
});

describe("getDefaultSets - with a FitBot program target load", () => {
  const hist = mk("2026-07-05", [
    { id: "sq", setsData: [{ weight: 155, reps: 6, completed: true }] },
  ]);

  it("prefills the first row's weight from targetLoadLbs when there is no history", () => {
    const rows = getDefaultSets(null, "lbs", "weight_reps", { sets: 4, reps: 5, targetLoadLbs: 135 });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ weight: 135, reps: 5 });
    expect(rows.slice(1).every((r) => r.weight === null)).toBe(true);
  });

  it("converts the lb target to the display unit (kg)", () => {
    const rows = getDefaultSets(null, "kg", "weight_reps", { targetLoadLbs: 135 });
    expect(rows[0].weight).not.toBeNull();
    expect(rows[0].weight! < 135 && rows[0].weight! > 0).toBe(true);
  });

  it("does not change row count when only a target load is given (no plan.sets)", () => {
    expect(getDefaultSets(null, "lbs", "weight_reps", { targetLoadLbs: 135 })).toHaveLength(3);
  });

  it("lets recorded history win on row 0 over the target load", () => {
    const rows = getDefaultSets({ weight: 155, reps: 6, distance: null, time: null }, "lbs", "weight_reps", { targetLoadLbs: 135, reps: 5 });
    expect(rows[0]).toMatchObject({ weight: 155, reps: 6 });
  });
});

describe("parseRepsPrescription", () => {
  it("reads a plain number", () => {
    expect(parseRepsPrescription("8")).toEqual({ label: "8", prefillReps: 8 });
    expect(parseRepsPrescription(10)).toEqual({ label: "10", prefillReps: 10 });
  });

  it("prefills the LOW end of a range but shows the range", () => {
    // Ivo imported a program prescribing "3-4 sets, 6-8 reps" and none of it
    // surfaced. The target is to REACH the top of the range, so prefilling 8
    // would log the best case before the work is done.
    expect(parseRepsPrescription("6-8")).toEqual({ label: "6-8", prefillReps: 6 });
  });

  it("shows an unparseable prescription and prefills nothing", () => {
    expect(parseRepsPrescription("AMRAP")).toEqual({ label: "AMRAP", prefillReps: null });
  });

  it("handles a qualified range", () => {
    expect(parseRepsPrescription("8-12 each side")).toEqual({
      label: "8-12 each side",
      prefillReps: 8,
    });
  });

  it("is empty for missing or blank input", () => {
    expect(parseRepsPrescription(null)).toEqual({ label: null, prefillReps: null });
    expect(parseRepsPrescription("   ")).toEqual({ label: null, prefillReps: null });
  });
});

describe("formatTargetLine", () => {
  it("joins sets and reps", () => {
    expect(formatTargetLine({ sets: 3, repsLabel: "6-8" })).toBe("3 sets x 6-8 reps");
  });

  it("singularises one set and omits absent halves", () => {
    expect(formatTargetLine({ sets: 1, repsLabel: null })).toBe("1 set");
    expect(formatTargetLine({ sets: null, repsLabel: "AMRAP" })).toBe("AMRAP reps");
  });

  it("is null when there is no target at all", () => {
    expect(formatTargetLine(undefined)).toBeNull();
    expect(formatTargetLine({ sets: null, repsLabel: null })).toBeNull();
  });
});

describe("the last-time line", () => {
  const lbs = (v: number | null) => v;
  const kg = (v: number | null) => (v == null ? null : Math.round((v / 2.20462) * 10) / 10);
  const lift = { usesWeight: true, usesReps: true, usesTime: false, usesDistance: false };
  const session = (sets: Array<Partial<{ weightLbs: number; reps: number; time: number; distance: number }>>) => ({
    date: "2026-09-24",
    workoutName: "Chest & Triceps",
    sets: sets.map((s) => ({
      weightLbs: s.weightLbs ?? null,
      reps: s.reps ?? null,
      time: s.time ?? null,
      distance: s.distance ?? null,
    })),
  });

  it("reads every set back in order, with the unit once", async () => {
    const { formatLastSessionSets } = await import("@/lib/track-helpers");
    const line = formatLastSessionSets(
      session([{ weightLbs: 135, reps: 8 }, { weightLbs: 135, reps: 8 }, { weightLbs: 135, reps: 6 }]),
      { unit: "lbs", toDisplay: lbs, ...lift },
    );
    expect(line).toBe("135 x 8, 135 x 8, 135 x 6 lbs");
  });

  it("speaks the viewer's unit", async () => {
    const { formatLastSessionSets } = await import("@/lib/track-helpers");
    expect(
      formatLastSessionSets(session([{ weightLbs: 100, reps: 5 }]), { unit: "kg", toDisplay: kg, ...lift }),
    ).toBe("45.4 x 5 kg");
  });

  it("calls a zero-load set bodyweight rather than 0", async () => {
    const { formatLastSessionSets } = await import("@/lib/track-helpers");
    expect(
      formatLastSessionSets(session([{ weightLbs: 0, reps: 10 }, { weightLbs: 0, reps: 8 }]), {
        unit: "lbs",
        toDisplay: lbs,
        ...lift,
      }),
    ).toBe("BW x 10, BW x 8");
  });

  it("says assist on an assisted lift, where the weight is help and not load", async () => {
    const { formatLastSessionSets } = await import("@/lib/track-helpers");
    expect(
      formatLastSessionSets(session([{ weightLbs: 40, reps: 8 }]), {
        unit: "lbs",
        toDisplay: lbs,
        ...lift,
        assisted: true,
      }),
    ).toBe("40 assist x 8 lbs");
  });

  it("reads a hold as a duration, with its load when there was one", async () => {
    const { formatLastSessionSets } = await import("@/lib/track-helpers");
    const hold = { usesWeight: true, usesReps: false, usesTime: true, usesDistance: false };
    expect(
      formatLastSessionSets(session([{ weightLbs: 25, time: 60 }, { weightLbs: 0, time: 45 }]), {
        unit: "lbs",
        toDisplay: lbs,
        ...hold,
      }),
    ).toBe("60s at 25 lbs, 45s");
  });

  it("reads cardio as distance and time, with no weight unit", async () => {
    const { formatLastSessionSets } = await import("@/lib/track-helpers");
    const cardio = { usesWeight: false, usesReps: false, usesTime: true, usesDistance: true };
    expect(
      formatLastSessionSets(session([{ distance: 1.5, time: 12 }]), { unit: "lbs", toDisplay: lbs, ...cardio }),
    ).toBe("1.5 mi in 12 min");
  });

  it("names the day, and the year only when it is not this one", async () => {
    const { formatSessionDate } = await import("@/lib/track-helpers");
    expect(formatSessionDate("2026-09-24", "2026-09-30")).toBe("Sep 24");
    expect(formatSessionDate("2025-12-31", "2026-09-30")).toBe("Dec 31, 2025");
  });
});
