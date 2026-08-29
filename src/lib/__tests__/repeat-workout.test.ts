import { describe, it, expect } from "vitest";
import { exercisesFromCompletedWorkout } from "@/lib/repeat-workout";

const set = (o: Record<string, unknown> = {}) => ({
  weight: 100, reps: 5, distance: 0, time: 0, completed: true, ...o,
});

describe("exercisesFromCompletedWorkout", () => {
  it("carries set count and the LAST logged load", () => {
    // The last set is where the session really finished, after any warm-up.
    const out = exercisesFromCompletedWorkout([
      { id: "a", name: "Bench", muscleGroups: ["Chest"], exerciseType: "weight_reps",
        setsData: [set({ weight: 95 }), set({ weight: 105, reps: 3 })] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", sets: 2, defaultWeight: 105, defaultReps: 3 });
  });

  it("DROPS an exercise with nothing logged", () => {
    // Repeating a session you abandoned should give you the half you did. An
    // abandoned exercise keeps prefilled rows that look like data but are not.
    const out = exercisesFromCompletedWorkout([
      { id: "done", name: "Done", setsData: [set()] },
      { id: "skipped", name: "Skipped", setsData: [set({ completed: false }), set({ completed: false })] },
      { id: "empty", name: "Never opened", setsData: [] },
    ]);
    expect(out.map((e) => e.id)).toEqual(["done"]);
  });

  it("counts only the COMPLETED sets, not every row", () => {
    const out = exercisesFromCompletedWorkout([
      { id: "a", name: "Rows", setsData: [set(), set(), set({ completed: false })] },
    ]);
    expect(out[0].sets).toBe(2);
  });

  it("does not carry reps for a hold or a cardio bout", () => {
    const holds = exercisesFromCompletedWorkout([
      { id: "h", name: "Plate Pinch", exerciseType: "weight_time",
        setsData: [set({ weight: 25, reps: 0, time: 60 })] },
    ]);
    expect(holds[0]).toMatchObject({ defaultWeight: 25, defaultReps: 0 });
  });

  it("skips rows with no exercise id, which cannot be started", () => {
    expect(exercisesFromCompletedWorkout([{ name: "Orphan", setsData: [set()] }])).toEqual([]);
  });

  it("is empty for missing or malformed input", () => {
    expect(exercisesFromCompletedWorkout(null)).toEqual([]);
    expect(exercisesFromCompletedWorkout(undefined)).toEqual([]);
    expect(exercisesFromCompletedWorkout([])).toEqual([]);
  });
});
