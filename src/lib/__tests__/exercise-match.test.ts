import { describe, it, expect } from "vitest";
import {
  normalizeExerciseName,
  nameMatchScore,
  matchExercise,
  DEFAULT_MATCH_THRESHOLD,
} from "@/lib/exercise-match";

describe("normalizeExerciseName", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeExerciseName("  Bulgarian   Split-Squat! ")).toBe(
      "bulgarian split squat",
    );
    expect(normalizeExerciseName("Push-Up")).toBe("push up");
    expect(normalizeExerciseName("DEADLIFT")).toBe("deadlift");
  });
});

describe("nameMatchScore", () => {
  it("scores an exact (case/punctuation-insensitive) match as 1", () => {
    expect(nameMatchScore("Deadlift", "deadlift")).toBe(1);
    expect(nameMatchScore("Bench Press", "bench-press")).toBe(1);
  });

  it("treats reordered token sets as a strong match (the Bulgarian case)", () => {
    const s = nameMatchScore("Bulgarian Split Squat", "Split Squat Bulgarian");
    expect(s).toBeGreaterThanOrEqual(0.95);
  });

  it("bridges spaced vs joined compounds", () => {
    expect(nameMatchScore("Push Up", "Pushup")).toBeGreaterThanOrEqual(0.95);
    expect(nameMatchScore("Pull Up", "pullup")).toBeGreaterThanOrEqual(0.95);
  });

  it("bridges singular vs plural", () => {
    expect(nameMatchScore("Bicep Curl", "Bicep Curls")).toBeGreaterThanOrEqual(
      0.95,
    );
    expect(nameMatchScore("Lunge", "Lunges")).toBeGreaterThanOrEqual(0.95);
    expect(nameMatchScore("Pushup", "Pushups")).toBeGreaterThanOrEqual(0.95);
  });

  it("does NOT collapse a movement with its named variant", () => {
    // Bulgarian Split Squat is a distinct exercise from a plain Split Squat.
    expect(nameMatchScore("Split Squat", "Bulgarian Split Squat")).toBeLessThan(
      DEFAULT_MATCH_THRESHOLD,
    );
  });

  it("does NOT match different movements that share a word", () => {
    expect(nameMatchScore("Bench Press", "Leg Press")).toBeLessThan(
      DEFAULT_MATCH_THRESHOLD,
    );
    expect(nameMatchScore("Barbell Squat", "Barbell Row")).toBeLessThan(
      DEFAULT_MATCH_THRESHOLD,
    );
  });

  it("keeps 'press' intact (does not strip the double-s as a plural)", () => {
    expect(nameMatchScore("Overhead Press", "Overhead Press")).toBe(1);
  });

  it("scores empty / whitespace names as 0", () => {
    expect(nameMatchScore("", "deadlift")).toBe(0);
    expect(nameMatchScore("   ", "deadlift")).toBe(0);
  });
});

describe("matchExercise", () => {
  const catalog = [
    { id: "1", name: "Split Squat Bulgarian" },
    { id: "2", name: "Barbell Bench Press" },
    { id: "3", name: "Bicep Curls" },
    { id: "4", name: "Plank" },
  ];

  it("resolves a reordered name to the existing library exercise", () => {
    const m = matchExercise("Bulgarian Split Squat", catalog);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("1");
  });

  it("resolves a plural/singular difference", () => {
    const m = matchExercise("Bicep Curl", catalog);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("3");
  });

  it("returns null when nothing clears the threshold (create-new)", () => {
    // "Glute Bridge" shares no strong signal with anything in the catalog.
    expect(matchExercise("Glute Bridge", catalog)).toBeNull();
  });

  it("does not match a plain Bench Press onto Barbell Bench Press", () => {
    // Equipment-qualified variant is treated as distinct (safe: create new).
    expect(matchExercise("Bench Press", catalog)).toBeNull();
  });

  it("returns the highest-scoring match when several clear the threshold", () => {
    const dupes = [
      { id: "a", name: "Bicep Curl Variation" }, // partial overlap
      { id: "b", name: "Bicep Curls" }, // near-exact
    ];
    const m = matchExercise("Bicep Curl", dupes);
    expect(m!.id).toBe("b");
  });

  it("returns null for an empty candidate", () => {
    expect(matchExercise("", catalog)).toBeNull();
  });
});
