import { describe, it, expect } from "vitest";
import { buildResumeState, combinedDuration } from "@/lib/resume-workout";

const ex = (o: Record<string, unknown> = {}) => ({
  id: "a", name: "Bench", muscleGroups: ["Chest"], exerciseType: "weight_reps", ...o,
});

describe("buildResumeState", () => {
  it("keeps EVERY exercise, including ones never started", () => {
    // The whole point of resuming is to do the part you did not get to. This is
    // the opposite of repeating, which keeps only what was logged.
    const { exercises } = buildResumeState(
      [
        ex({ id: "done", setsData: [{ weight: 100, reps: 5, completed: true }] }),
        ex({ id: "skipped", setsData: [{ weight: 25, reps: 10, completed: false }] }),
        ex({ id: "untouched", setsData: [] }),
      ],
      "w1",
      1,
    );
    expect(exercises.map((e) => e.id)).toEqual(["done", "skipped", "untouched"]);
  });

  it("preserves each row's logged state in both directions", () => {
    const { exerciseSets } = buildResumeState(
      [ex({ setsData: [
        { weight: 100, reps: 5, completed: true },
        { weight: 100, reps: 5, completed: false },
      ] })],
      "w1",
      1,
    );
    const [, sets] = exerciseSets[0];
    expect(sets.map((s) => s.completed)).toEqual([true, false]);
    expect(sets[0]).toMatchObject({ weight: 100, reps: 5 });
  });

  it("keys progress with the SAME instanceId as the exercise", () => {
    // Progress is keyed by instanceId; a mismatch strands every restored set,
    // which this codebase has lost sets to before.
    const { exercises, exerciseSets } = buildResumeState([ex()], "w1", 7);
    expect(exerciseSets[0][0]).toBe(exercises[0].instanceId);
  });

  it("gives an exercise with no rows one row to type into", () => {
    const { exerciseSets } = buildResumeState([ex({ setsData: [] })], "w1", 1);
    expect(exerciseSets[0][1]).toHaveLength(1);
    expect(exerciseSets[0][1][0].completed).toBe(false);
  });

  it("skips rows with no exercise id", () => {
    const { exercises } = buildResumeState([{ name: "Orphan" }], "w1", 1);
    expect(exercises).toEqual([]);
  });

  it("handles missing input", () => {
    expect(buildResumeState(null, "w1", 1).exercises).toEqual([]);
  });
});

describe("combinedDuration", () => {
  it("ADDS the two sittings rather than spanning the gap", () => {
    // Coming back an hour later must not log the hour away from the gym.
    expect(combinedDuration(1800, 900)).toBe(2700);
  });

  it("treats missing or negative values as zero", () => {
    expect(combinedDuration(null, 600)).toBe(600);
    expect(combinedDuration(600, undefined)).toBe(600);
    expect(combinedDuration(-5, -5)).toBe(0);
  });
});
