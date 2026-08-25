import { describe, it, expect } from "vitest";
import {
  ImportedPlanSchema,
  ImportedExerciseSchema,
  planExerciseNames,
  planTrainingDayCount,
} from "@/lib/import-schema";

/**
 * The parse costs a metered AI call, so like the program schema this must
 * normalize sloppy model output rather than throw the import away.
 */

const ex = (o: Record<string, unknown> = {}) => ({
  name: "Bench Press",
  muscleGroups: ["Chest"],
  exerciseType: "weight_reps",
  sets: 4,
  reps: "5",
  rest: 180,
  notes: "",
  ...o,
});

describe("ImportedExerciseSchema tolerance", () => {
  it("normalises an invented exerciseType instead of rejecting", () => {
    expect(ImportedExerciseSchema.parse(ex({ exerciseType: "cardio" })).exerciseType).toBe("distance_time");
    expect(ImportedExerciseSchema.parse(ex({ exerciseType: "time_based" })).exerciseType).toBe("distance_time");
    expect(ImportedExerciseSchema.parse(ex({ exerciseType: "nonsense" })).exerciseType).toBe("weight_reps");
  });

  it("coerces numeric reps to the prescription string", () => {
    expect(ImportedExerciseSchema.parse(ex({ reps: 12 })).reps).toBe("12");
  });

  it("accepts a rest written as a string with units", () => {
    expect(ImportedExerciseSchema.parse(ex({ rest: "180" })).rest).toBe(180);
    expect(ImportedExerciseSchema.parse(ex({ rest: "90 seconds" })).rest).toBe(90);
  });

  it("clamps absurd sets and rest rather than failing", () => {
    expect(ImportedExerciseSchema.parse(ex({ sets: 500 })).sets).toBe(20);
    expect(ImportedExerciseSchema.parse(ex({ sets: 0 })).sets).toBe(1);
    expect(ImportedExerciseSchema.parse(ex({ rest: -30 })).rest).toBe(0);
  });

  it("falls back sensibly when numbers are missing entirely", () => {
    const parsed = ImportedExerciseSchema.parse({ name: "Plank" });
    expect(parsed.sets).toBe(3);
    expect(parsed.rest).toBe(90);
    expect(parsed.exerciseType).toBe("weight_reps");
    expect(parsed.muscleGroups).toEqual([]);
  });
});

describe("ImportedPlanSchema", () => {
  it("parses a single workout", () => {
    const plan = ImportedPlanSchema.parse({
      kind: "workout",
      name: "Upper A",
      exercises: [ex(), ex({ name: "Row" })],
    });
    expect(plan.kind).toBe("workout");
    expect(planTrainingDayCount(plan)).toBe(1);
  });

  it("parses a routine including rest days", () => {
    const plan = ImportedPlanSchema.parse({
      kind: "routine",
      name: "PPL",
      cycleLength: 4,
      days: [
        { dayIndex: 1, workoutName: "Push", isRest: false, exercises: [ex()] },
        { dayIndex: 2, workoutName: "Pull", isRest: false, exercises: [ex({ name: "Row" })] },
        { dayIndex: 3, workoutName: "Legs", isRest: false, exercises: [ex({ name: "Squat" })] },
        { dayIndex: 4, workoutName: "Rest", isRest: true, exercises: [] },
      ],
    });
    expect(planTrainingDayCount(plan)).toBe(3);
  });

  it("treats a string isRest as a boolean", () => {
    const plan = ImportedPlanSchema.parse({
      kind: "routine",
      name: "X",
      cycleLength: 2,
      days: [
        { dayIndex: 1, workoutName: "A", isRest: "false", exercises: [ex()] },
        { dayIndex: 2, workoutName: "Rest", isRest: "true", exercises: [] },
      ],
    });
    expect(plan.kind === "routine" && plan.days[1].isRest).toBe(true);
    expect(planTrainingDayCount(plan)).toBe(1);
  });

  it("rejects an unknown kind outright", () => {
    // The commit route branches on kind, so this one really must not be guessed.
    expect(ImportedPlanSchema.safeParse({ kind: "mystery", name: "X" }).success).toBe(false);
  });
});

describe("planExerciseNames", () => {
  it("dedupes case-insensitively and keeps first-appearance order", () => {
    const plan = ImportedPlanSchema.parse({
      kind: "routine",
      name: "X",
      cycleLength: 2,
      days: [
        { dayIndex: 1, workoutName: "A", isRest: false, exercises: [ex({ name: "Squat" }), ex({ name: "Bench" })] },
        { dayIndex: 2, workoutName: "B", isRest: false, exercises: [ex({ name: "squat" }), ex({ name: "Row" })] },
      ],
    });
    // "squat" must not create a second catalog row on commit.
    expect(planExerciseNames(plan)).toEqual(["Squat", "Bench", "Row"]);
  });
});
