import { describe, it, expect } from "vitest";
import { EditedRoutineSchema } from "@/lib/routine-edit-schema";

const day = (over: Record<string, unknown> = {}) => ({
  dayIndex: 1,
  workoutName: "Push",
  exercises: [{ name: "Barbell Bench Press", sets: 4, reps: "6-8", rest: 150 }],
  ...over,
});

describe("EditedRoutineSchema", () => {
  it("accepts a well-formed edit", () => {
    const r = EditedRoutineSchema.safeParse({ days: [day()], cycleLength: 7, summary: "ok" });
    expect(r.success).toBe(true);
  });

  it("keeps a rep RANGE as text instead of collapsing it", () => {
    const r = EditedRoutineSchema.parse({ days: [day()] });
    expect(r.days[0].exercises[0].reps).toBe("6-8");
  });

  it("stringifies a numeric rep count rather than rejecting the whole edit", () => {
    // The lesson program-schema already paid for: a strict parse fails AFTER
    // the quota unit is charged, so coerce what can be coerced.
    const r = EditedRoutineSchema.parse({
      days: [day({ exercises: [{ name: "Row", sets: 3, reps: 10, rest: 90 }] })],
    });
    expect(r.days[0].exercises[0].reps).toBe("10");
  });

  it("clamps nonsense set counts instead of failing", () => {
    const r = EditedRoutineSchema.parse({
      days: [day({ exercises: [{ name: "Row", sets: 99, reps: "8", rest: 90 }] })],
    });
    expect(r.days[0].exercises[0].sets).toBe(10);
  });

  it("leaves targetLoadLbs absent when the model omits it", () => {
    // Only the deterministic progression may set one; inventing a load for an
    // accessory would put a number on the bar nobody computed.
    const r = EditedRoutineSchema.parse({ days: [day()] });
    expect(r.days[0].exercises[0].targetLoadLbs).toBeUndefined();
  });

  it("carries targetLoadLbs through when it is present", () => {
    const r = EditedRoutineSchema.parse({
      days: [day({ exercises: [{ name: "Squat", sets: 5, reps: "5", rest: 180, targetLoadLbs: 225 }] })],
    });
    expect(r.days[0].exercises[0].targetLoadLbs).toBe(225);
  });

  it("rejects an edit with no days at all", () => {
    expect(EditedRoutineSchema.safeParse({ days: [] }).success).toBe(false);
  });

  it("defaults changes and summary so a terse model still parses", () => {
    const r = EditedRoutineSchema.parse({ days: [day()] });
    expect(r.changes).toEqual([]);
    expect(r.summary).toBe("");
  });
});
