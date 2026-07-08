import { describe, it, expect } from "vitest";
import { getLastRecordedValues, getDefaultSets } from "@/lib/track-helpers";

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
    const sets = getDefaultSets([], "lbs", "ex1", "weight_reps");
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.weight === null)).toBe(true);
  });

  it("defaults to 1 empty set for distance_time with no history", () => {
    expect(getDefaultSets([], "lbs", "ex1", "distance_time")).toHaveLength(1);
  });

  it("prefills the first set from history, converting to the display unit", () => {
    const w = mk("2026-07-05", [{ id: "ex1", setsData: [{ weight: 135, reps: 5, completed: true }] }]);
    const lbs = getDefaultSets([w], "lbs", "ex1", "weight_reps");
    expect(lbs[0].weight).toBe(135);
    const kg = getDefaultSets([w], "kg", "ex1", "weight_reps");
    expect(kg[0].weight).toBe(61.2); // 135 lbs -> kg, 1 decimal
    expect(kg[0].reps).toBe(5);
  });
});

describe("getDefaultSets — with a FitBot plan", () => {
  const hist = mk("2026-07-05", [
    { id: "sq", setsData: [{ weight: 135, reps: 5, completed: true }] },
  ]);

  it("uses the plan's set count for the number of rows", () => {
    expect(getDefaultSets([], "lbs", "new", "weight_reps", { sets: 4, reps: 12 })).toHaveLength(4);
  });

  it("prefills the first row's reps from the plan when there is no history", () => {
    const rows = getDefaultSets([], "lbs", "new", "weight_reps", { sets: 4, reps: 12 });
    expect(rows[0]).toMatchObject({ reps: 12, weight: null });
    expect(rows.slice(1).every((r) => r.reps === null)).toBe(true);
  });

  it("leaves reps blank for an AMRAP-style plan (null target)", () => {
    const rows = getDefaultSets([], "lbs", "new", "weight_reps", { sets: 3, reps: null });
    expect(rows.every((r) => r.reps === null)).toBe(true);
  });

  it("honours the plan set count for distance/time but never prefills reps", () => {
    const rows = getDefaultSets([], "lbs", "core", "distance_time", { sets: 3, reps: 30 });
    expect(rows).toHaveLength(3);
    expect(rows[0].reps).toBeNull();
  });

  it("lets recorded history win on the first row while the plan still sets the count", () => {
    const rows = getDefaultSets([hist], "lbs", "sq", "weight_reps", { sets: 5, reps: 8 });
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ weight: 135, reps: 5 });
  });

  it("clamps a zero/negative plan count to at least one row", () => {
    expect(getDefaultSets([], "lbs", "x", "weight_reps", { sets: 0 })).toHaveLength(1);
  });
});

describe("getDefaultSets — with a FitBot program target load", () => {
  const hist = mk("2026-07-05", [
    { id: "sq", setsData: [{ weight: 155, reps: 6, completed: true }] },
  ]);

  it("prefills the first row's weight from targetLoadLbs when there is no history", () => {
    const rows = getDefaultSets([], "lbs", "bench", "weight_reps", { sets: 4, reps: 5, targetLoadLbs: 135 });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ weight: 135, reps: 5 });
    expect(rows.slice(1).every((r) => r.weight === null)).toBe(true);
  });

  it("converts the lb target to the display unit (kg)", () => {
    const rows = getDefaultSets([], "kg", "bench", "weight_reps", { targetLoadLbs: 135 });
    expect(rows[0].weight).not.toBeNull();
    expect(rows[0].weight! < 135 && rows[0].weight! > 0).toBe(true);
  });

  it("does not change row count when only a target load is given (no plan.sets)", () => {
    expect(getDefaultSets([], "lbs", "bench", "weight_reps", { targetLoadLbs: 135 })).toHaveLength(3);
  });

  it("lets recorded history win on row 0 over the target load", () => {
    const rows = getDefaultSets([hist], "lbs", "sq", "weight_reps", { targetLoadLbs: 135, reps: 5 });
    expect(rows[0]).toMatchObject({ weight: 155, reps: 6 });
  });
});
