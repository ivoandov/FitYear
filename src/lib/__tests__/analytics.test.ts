import { describe, it, expect } from "vitest";
import { overloadSuggestion } from "@/lib/analytics";

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
