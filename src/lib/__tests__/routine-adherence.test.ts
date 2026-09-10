import { describe, it, expect } from "vitest";
import {
  diffSession,
  sameExercise,
  summarizeDay,
  summarizeAdherence,
  type PerformedSession,
  type PlannedExercise,
} from "@/lib/routine-adherence";

const AT = new Date("2026-09-01T18:00:00Z");

function session(
  exercises: { name: string; sets: number; topWeightLbs?: number | null }[],
  overrides: Partial<PerformedSession> = {},
): PerformedSession {
  return {
    completedWorkoutId: "cw1",
    dayIndex: 2,
    completedAt: AT,
    exercises: exercises.map((e) => ({
      name: e.name,
      sets: e.sets,
      topWeightLbs: e.topWeightLbs ?? null,
    })),
    ...overrides,
  };
}

describe("sameExercise", () => {
  it("treats a moved equipment word as the same movement", () => {
    // The catalog canonicalises to "Cable Bicep Curls", but history keeps its
    // own snapshot, so both spellings genuinely coexist. Reading them as a drop
    // plus an add would invent a change the user never made.
    expect(sameExercise("Cable Bicep Curls", "Bicep Curls - Cable")).toBe(true);
  });

  it("keeps genuinely distinct movements apart", () => {
    // 0.67 is the score of this pair AND of several real near-duplicates, which
    // is why the threshold must not be lowered to catch it.
    expect(sameExercise("Split Squats", "Bulgarian Split Squats")).toBe(false);
  });
});

describe("diffSession", () => {
  const planned: PlannedExercise[] = [
    { name: "Barbell Bench Press", sets: 4, reps: "6-8" },
    { name: "Overhead Press", sets: 3, reps: "8-10" },
  ];

  it("reports an exercise the user added", () => {
    const d = diffSession(
      planned,
      session([
        { name: "Barbell Bench Press", sets: 4 },
        { name: "Overhead Press", sets: 3 },
        { name: "Cable Bicep Curls", sets: 3 },
      ]),
    );
    expect(d.added.map((a) => a.name)).toEqual(["Cable Bicep Curls"]);
    expect(d.dropped).toEqual([]);
    expect(d.setChanges).toEqual([]);
  });

  it("reports a prescribed exercise that was skipped", () => {
    const d = diffSession(planned, session([{ name: "Barbell Bench Press", sets: 4 }]));
    expect(d.dropped.map((x) => x.name)).toEqual(["Overhead Press"]);
    expect(d.added).toEqual([]);
  });

  it("reports a set count that differs from the prescription", () => {
    const d = diffSession(
      planned,
      session([
        { name: "Barbell Bench Press", sets: 5 },
        { name: "Overhead Press", sets: 3 },
      ]),
    );
    expect(d.setChanges).toEqual([
      { name: "Barbell Bench Press", plannedSets: 4, performedSets: 5 },
    ]);
  });

  it("says nothing about sets the plan never prescribed", () => {
    // A plan with no set count has nothing to deviate FROM. Reporting a change
    // here would manufacture a deviation out of a missing field.
    const d = diffSession(
      [{ name: "Barbell Bench Press", sets: null, reps: "AMRAP" }],
      session([{ name: "Barbell Bench Press", sets: 6 }]),
    );
    expect(d.setChanges).toEqual([]);
  });

  it("does not read a renamed spelling as a swap", () => {
    const d = diffSession(
      [{ name: "Bicep Curls - Cable", sets: 3, reps: "10" }],
      session([{ name: "Cable Bicep Curls", sets: 3 }]),
    );
    expect(d.added).toEqual([]);
    expect(d.dropped).toEqual([]);
  });
});

describe("summarizeDay", () => {
  const planned: PlannedExercise[] = [
    { name: "Barbell Bench Press", sets: 4, reps: "6-8" },
    { name: "Overhead Press", sets: 3, reps: "8-10" },
  ];

  it("counts how often a habit repeats, so a one-off stays distinguishable", () => {
    const p = summarizeDay(2, "Push", planned, [
      session(
        [
          { name: "Barbell Bench Press", sets: 4 },
          { name: "Overhead Press", sets: 3 },
          { name: "Cable Bicep Curls", sets: 3 },
        ],
        { completedWorkoutId: "a" },
      ),
      session(
        [
          { name: "Barbell Bench Press", sets: 4 },
          { name: "Overhead Press", sets: 3 },
          { name: "Cable Bicep Curls", sets: 3 },
        ],
        { completedWorkoutId: "b" },
      ),
      session(
        [
          { name: "Barbell Bench Press", sets: 4 },
          { name: "Overhead Press", sets: 3 },
          { name: "Lateral Raises", sets: 2 },
        ],
        { completedWorkoutId: "c" },
      ),
    ]);

    expect(p.sessionCount).toBe(3);
    // Curls twice is a habit; the lateral raise once is a Tuesday. Both are
    // reported, with the counts that tell them apart.
    expect(p.added).toEqual([
      { name: "Cable Bicep Curls", timesAdded: 2 },
      { name: "Lateral Raises", timesAdded: 1 },
    ]);
  });

  it("folds one movement's two spellings into a single row", () => {
    const p = summarizeDay(2, "Push", planned, [
      session([{ name: "Cable Bicep Curls", sets: 3 }], { completedWorkoutId: "a" }),
      session([{ name: "Bicep Curls - Cable", sets: 3 }], { completedWorkoutId: "b" }),
    ]);
    expect(p.added).toEqual([{ name: "Cable Bicep Curls", timesAdded: 2 }]);
  });

  it("reports the set count the user actually settles on", () => {
    const p = summarizeDay(2, "Push", planned, [
      session([{ name: "Barbell Bench Press", sets: 5 }], { completedWorkoutId: "a" }),
      session([{ name: "Barbell Bench Press", sets: 5 }], { completedWorkoutId: "b" }),
    ]);
    expect(p.setChanges).toEqual([
      { name: "Barbell Bench Press", plannedSets: 4, typicalSets: 5, sessions: 2 },
    ]);
  });
});

describe("summarizeAdherence", () => {
  it("distinguishes no data from no change", () => {
    // These are very different statements and a coach must not confuse them.
    const s = summarizeAdherence("PPL", [
      { dayIndex: 1, workoutName: "Push", planned: [{ name: "Bench", sets: 3 }], sessions: [] },
    ]);
    expect(s.noData).toBe(true);
    expect(s.sessionsCompleted).toBe(0);
    expect(s.patterns).toEqual([]);
  });

  it("only reports days that actually have sessions", () => {
    const s = summarizeAdherence("PPL", [
      { dayIndex: 1, workoutName: "Push", planned: [{ name: "Bench", sets: 3 }], sessions: [] },
      {
        dayIndex: 2,
        workoutName: "Pull",
        planned: [{ name: "Rows", sets: 3 }],
        sessions: [session([{ name: "Rows", sets: 3 }], { dayIndex: 2 })],
      },
    ]);
    expect(s.noData).toBe(false);
    expect(s.daysWithData).toBe(1);
    expect(s.patterns[0].dayIndex).toBe(2);
  });
});
