import { describe, it, expect } from "vitest";
import {
  EXERCISE_TYPES,
  hasVolume,
  normalizeExerciseType,
  usesDistance,
  usesReps,
  usesTime,
  usesWeight,
} from "@/lib/exercise-types";

describe("normalizeExerciseType", () => {
  it("passes through the three real types", () => {
    for (const t of EXERCISE_TYPES) expect(normalizeExerciseType(t)).toBe(t);
  });

  it("falls back to weight_reps for anything unrecognised", () => {
    // The column's own default, so an unknown value never invents a shape.
    expect(normalizeExerciseType(undefined)).toBe("weight_reps");
    expect(normalizeExerciseType(null)).toBe("weight_reps");
    expect(normalizeExerciseType("nonsense")).toBe("weight_reps");
    expect(normalizeExerciseType(42)).toBe("weight_reps");
  });

  it("tolerates the spellings models and importers emit", () => {
    // program-schema already had to be made tolerant of this exact class of
    // sloppiness after a paid FitBot build failed on it.
    expect(normalizeExerciseType("Weight Time")).toBe("weight_time");
    expect(normalizeExerciseType("weight-time")).toBe("weight_time");
    expect(normalizeExerciseType("cardio")).toBe("distance_time");
  });

  it("only maps UNAMBIGUOUSLY static words to weight_time", () => {
    expect(normalizeExerciseType("isometric")).toBe("weight_time");
    expect(normalizeExerciseType("plank")).toBe("weight_time");
    expect(normalizeExerciseType("pinch")).toBe("weight_time");
  });

  it("leaves an AMBIGUOUS duration word on distance_time", () => {
    // A plank and a 500m row interval are both "time". The tolerance exists for
    // observed model output, which was conditioning work, so guessing "hold"
    // here would strip the distance off a timed row. Picking weight_time
    // deliberately is what the exercise editor is for.
    expect(normalizeExerciseType("time")).toBe("distance_time");
    expect(normalizeExerciseType("time_based")).toBe("distance_time");
    expect(normalizeExerciseType("duration")).toBe("distance_time");
    expect(normalizeExerciseType("carry")).toBe("distance_time");
  });
});

describe("capabilities", () => {
  it("weight_reps is a loaded lift with volume", () => {
    expect(usesWeight("weight_reps")).toBe(true);
    expect(usesReps("weight_reps")).toBe(true);
    expect(usesTime("weight_reps")).toBe(false);
    expect(usesDistance("weight_reps")).toBe(false);
    expect(hasVolume("weight_reps")).toBe(true);
  });

  it("weight_time is a LOADED HOLD - weight and time, no reps", () => {
    expect(usesWeight("weight_time")).toBe(true);
    expect(usesReps("weight_time")).toBe(false);
    expect(usesTime("weight_time")).toBe(true);
    expect(usesDistance("weight_time")).toBe(false);
  });

  it("does NOT give a hold a volume", () => {
    // 25 lb for 60s is not 1500 of anything anyone trains by, and counting it
    // as volume would rank holds against squats.
    expect(hasVolume("weight_time")).toBe(false);
    expect(hasVolume("distance_time")).toBe(false);
  });

  it("distance_time is cardio, with no weight", () => {
    expect(usesWeight("distance_time")).toBe(false);
    expect(usesDistance("distance_time")).toBe(true);
    expect(usesTime("distance_time")).toBe(true);
  });
});
