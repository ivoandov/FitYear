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
