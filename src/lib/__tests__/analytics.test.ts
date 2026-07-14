import { describe, it, expect } from "vitest";
import { overloadSuggestion, consistencySummary, type DayCount } from "@/lib/analytics";

// Build `n` consecutive days (oldest first), with 1 workout on the given
// day-indexes (0 = oldest, n-1 = newest / today).
function days(n: number, active: number[]): DayCount[] {
  const set = new Set(active);
  return Array.from({ length: n }, (_, i) => ({
    day: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    workouts: set.has(i) ? 1 : 0,
  }));
}

describe("overloadSuggestion", () => {
  it("adds load when a normal lift hit the rep threshold", () => {
    const s = overloadSuggestion({ lastTopWeightLbs: 135, lastReps: 8, isAssisted: false });
    expect(s.kind).toBe("increase-weight");
    expect(s.suggestedWeightLbs).toBe(140);
    expect(s.suggestedReps).toBe(8);
  });

  it("adds a rep when a normal lift is below the rep threshold", () => {
    const s = overloadSuggestion({ lastTopWeightLbs: 185, lastReps: 5, isAssisted: false });
    expect(s.kind).toBe("add-rep");
    expect(s.suggestedWeightLbs).toBe(185);
    expect(s.suggestedReps).toBe(6);
  });

  it("respects a custom increment and threshold", () => {
    const s = overloadSuggestion({
      lastTopWeightLbs: 100,
      lastReps: 12,
      isAssisted: false,
      incrementLbs: 2.5,
      repThreshold: 10,
    });
    expect(s.kind).toBe("increase-weight");
    expect(s.suggestedWeightLbs).toBe(102.5);
  });

  it("reduces assistance for an assisted lift (lower weight = harder)", () => {
    const s = overloadSuggestion({ lastTopWeightLbs: 60, lastReps: 8, isAssisted: true });
    expect(s.kind).toBe("reduce-assist");
    expect(s.suggestedWeightLbs).toBe(55);
    expect(s.suggestedReps).toBe(8);
  });

  it("adds a rep for an assisted lift already near unassisted", () => {
    const s = overloadSuggestion({ lastTopWeightLbs: 5, lastReps: 6, isAssisted: true });
    expect(s.kind).toBe("add-rep");
    expect(s.suggestedReps).toBe(7);
  });

  it("rounds fractional inputs to one decimal", () => {
    const s = overloadSuggestion({ lastTopWeightLbs: 47.5, lastReps: 8, isAssisted: false, incrementLbs: 2.5 });
    expect(s.suggestedWeightLbs).toBe(50);
  });
});

describe("consistencySummary", () => {
  it("sums totals and active days", () => {
    const s = consistencySummary(days(28, [0, 3, 3, 10, 27])); // note: duplicate 3 collapses in the set
    expect(s.activeDays).toBe(4);
    expect(s.totalWorkouts).toBe(4);
    expect(s.totalWeeks).toBe(4);
  });

  it("counts distinct trailing weeks trained", () => {
    // 28 days = 4 trailing weeks (indexes 21-27 = week0, 14-20 = week1, ...).
    // Active on days 27 (wk0), 20 (wk1), 0 (wk3) -> 3 of 4 weeks trained.
    const s = consistencySummary(days(28, [0, 20, 27]));
    expect(s.weeksTrained).toBe(3);
    expect(s.totalWeeks).toBe(4);
  });

  it("current week streak counts consecutive most-recent active weeks", () => {
    // Active in the most recent 2 weeks (days 27=wk0, 18=wk1), gap at wk2, then wk3.
    const s = consistencySummary(days(28, [27, 18, 0]));
    expect(s.currentWeekStreak).toBe(2);
  });

  it("current week streak is 0 when the most recent week is empty", () => {
    // Only day 0 (the oldest week, wk3) is active.
    const s = consistencySummary(days(28, [0]));
    expect(s.currentWeekStreak).toBe(0);
    expect(s.weeksTrained).toBe(1);
  });

  it("handles an empty window", () => {
    const s = consistencySummary([]);
    expect(s).toEqual({ totalWorkouts: 0, activeDays: 0, totalWeeks: 1, weeksTrained: 0, currentWeekStreak: 0 });
  });
});
