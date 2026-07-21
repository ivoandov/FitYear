import { describe, it, expect } from "vitest";
import {
  deriveWorkoutName,
  detectPRs,
  summarizeWorkout,
  calcStreak,
  isRepTotalExercise,
  totalCompletedReps,
  type SetData,
  type ExerciseInWorkout,
} from "@/lib/workout-stats";

function set(partial: Partial<SetData>): SetData {
  return {
    setNumber: 1,
    weight: null,
    reps: null,
    distance: null,
    time: null,
    completed: false,
    ...partial,
  };
}

function ex(partial: Partial<ExerciseInWorkout>): ExerciseInWorkout {
  return { id: "x", name: "X", ...partial };
}

// noon on the day N days before today (local), avoiding DST edges
function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

describe("deriveWorkoutName", () => {
  it("joins the top two muscle groups by completed-set count", () => {
    const name = deriveWorkoutName([
      ex({ muscleGroups: ["Back"], setsData: [set({ completed: true }), set({ completed: true })] }),
      ex({ muscleGroups: ["Biceps"], setsData: [set({ completed: true })] }),
      ex({ muscleGroups: ["Legs"], setsData: [set({ completed: true })] }),
    ]);
    expect(name).toBe("Back & Biceps");
  });

  it("returns a single group when only one is trained", () => {
    expect(
      deriveWorkoutName([ex({ muscleGroups: ["Chest"], setsData: [set({ completed: true })] })]),
    ).toBe("Chest");
  });

  it("falls back to presence when no sets are completed yet", () => {
    expect(
      deriveWorkoutName([ex({ muscleGroups: ["Shoulders"], setsData: [set({ completed: false })] })]),
    ).toBe("Shoulders");
  });

  it("returns empty string when there is no muscle data", () => {
    expect(deriveWorkoutName([ex({ setsData: [set({ completed: true })] })])).toBe("");
    expect(deriveWorkoutName([])).toBe("");
  });
});

describe("detectPRs", () => {
  it("flags a heavier weight and higher volume as PRs for a normal exercise", () => {
    const prior = [{ exercises: [ex({ id: "e1", name: "Bench", setsData: [set({ weight: 100, reps: 5, completed: true })] })] }];
    const current = { exercises: [ex({ id: "e1", name: "Bench", setsData: [set({ weight: 110, reps: 5, completed: true })] })] };
    const hits = detectPRs(current, prior);
    expect(hits).toEqual([
      { exerciseId: "e1", exerciseName: "Bench", type: "weight", newValue: 110, previousValue: 100 },
      { exerciseId: "e1", exerciseName: "Bench", type: "volume", newValue: 550, previousValue: 500 },
    ]);
  });

  it("treats a first-ever exercise as a PR with null previous", () => {
    const current = { exercises: [ex({ id: "e2", name: "Row", setsData: [set({ weight: 80, reps: 8, completed: true })] })] };
    const hits = detectPRs(current, []);
    expect(hits).toEqual([
      { exerciseId: "e2", exerciseName: "Row", type: "weight", newValue: 80, previousValue: null },
      { exerciseId: "e2", exerciseName: "Row", type: "volume", newValue: 640, previousValue: null },
    ]);
  });

  it("does not flag a PR when neither weight nor volume beats history", () => {
    const prior = [{ exercises: [ex({ id: "e1", setsData: [set({ weight: 100, reps: 5, completed: true })] })] }];
    const current = { exercises: [ex({ id: "e1", setsData: [set({ weight: 90, reps: 5, completed: true })] })] };
    expect(detectPRs(current, prior)).toEqual([]);
  });

  it("inverts to MIN weight for assisted exercises and skips volume", () => {
    const assisted = new Map([["e3", true]]);
    const prior = [{ exercises: [ex({ id: "e3", name: "Assisted Pull-up", setsData: [set({ weight: 50, reps: 5, completed: true })] })] }];
    const lighter = { exercises: [ex({ id: "e3", name: "Assisted Pull-up", setsData: [set({ weight: 40, reps: 5, completed: true })] })] };
    const hits = detectPRs(lighter, prior, assisted);
    expect(hits).toEqual([
      { exerciseId: "e3", exerciseName: "Assisted Pull-up", type: "weight", newValue: 40, previousValue: 50 },
    ]);
    // More assistance (higher counterweight) is NOT a PR for an assisted lift.
    const heavier = { exercises: [ex({ id: "e3", name: "Assisted Pull-up", setsData: [set({ weight: 60, reps: 5, completed: true })] })] };
    expect(detectPRs(heavier, prior, assisted)).toEqual([]);
  });

  it("ignores uncompleted and zero-weight sets", () => {
    const current = { exercises: [ex({ id: "e4", setsData: [set({ weight: 200, reps: 5, completed: false }), set({ weight: 0, reps: 5, completed: true })] })] };
    expect(detectPRs(current, [])).toEqual([]);
  });
});

describe("summarizeWorkout", () => {
  it("counts only completed sets and sums their volume", () => {
    const s = summarizeWorkout({
      exercises: [
        ex({ muscleGroups: ["Chest"], setsData: [set({ weight: 100, reps: 5, completed: true }), set({ weight: 100, reps: 5, completed: false })] }),
        ex({ muscleGroups: ["Chest", "Triceps"], setsData: [set({ weight: 50, reps: 10, completed: true })] }),
      ],
      completedAt: new Date("2026-07-06T12:30:00Z"),
      startedAt: null,
      durationSeconds: 1800,
    });
    expect(s.totalSets).toBe(2);
    expect(s.totalVolumeLbs).toBe(100 * 5 + 50 * 10);
    expect(s.exerciseCount).toBe(2);
    expect(s.muscleGroups.get("Chest")).toBe(2); // 1 completed set on each Chest exercise
    expect(s.muscleGroups.get("Triceps")).toBe(1);
    expect(s.durationSeconds).toBe(1800);
  });

  it("derives duration from startedAt/completedAt when durationSeconds is absent", () => {
    const s = summarizeWorkout({
      exercises: [],
      completedAt: new Date("2026-07-06T12:01:00Z"),
      startedAt: new Date("2026-07-06T12:00:00Z"),
      durationSeconds: null,
    });
    expect(s.durationSeconds).toBe(60);
  });
});

describe("calcStreak", () => {
  it("returns 0 for no workouts", () => {
    expect(calcStreak([])).toBe(0);
  });

  it("does not require today, counts consecutive prior days", () => {
    expect(calcStreak([daysAgo(1), daysAgo(2)])).toBe(2);
  });

  it("counts today plus yesterday", () => {
    expect(calcStreak([daysAgo(0), daysAgo(1)])).toBe(2);
  });

  it("breaks on a gap", () => {
    // today + two-days-ago, missing yesterday -> streak is just today
    expect(calcStreak([daysAgo(0), daysAgo(2)])).toBe(1);
  });

  it("dedupes multiple workouts on the same day", () => {
    expect(calcStreak([daysAgo(1), daysAgo(1), daysAgo(2)])).toBe(2);
  });
});

describe("isRepTotalExercise", () => {
  it("matches every pull-up / push-up naming variant in the catalog", () => {
    for (const name of ["Pull-ups", "Pull Ups Assisted", "Pushups", "Knee Pushups", "pull up", "Push-Ups"]) {
      expect(isRepTotalExercise(name), name).toBe(true);
    }
  });

  it("does not match pulldowns, push downs, pull-aparts, or pull-throughs", () => {
    for (const name of [
      "Lat Pulldown",
      "Cable lat pull down",
      "Lat Pushdown",
      "Bar Push Downs",
      "Cable Push Down",
      "Band Pull-Apart",
      "Cable Pull-Through",
      "Face Pulls",
      "Bench Press",
    ]) {
      expect(isRepTotalExercise(name), name).toBe(false);
    }
  });

  it("handles empty and missing names", () => {
    expect(isRepTotalExercise("")).toBe(false);
    expect(isRepTotalExercise(null)).toBe(false);
    expect(isRepTotalExercise(undefined)).toBe(false);
  });
});

describe("totalCompletedReps", () => {
  it("sums reps of completed sets only, treating null reps as 0", () => {
    const lists: SetData[][] = [
      [
        set({ reps: 10, completed: true }),
        set({ reps: 8, completed: true }),
        set({ reps: 12, completed: false }),
        set({ reps: null, completed: true }),
      ],
    ];
    expect(totalCompletedReps(lists)).toBe(18);
  });

  it("sums across multiple instances of the exercise", () => {
    const lists: SetData[][] = [
      [set({ reps: 10, completed: true })],
      [set({ reps: 5, completed: true }), set({ reps: 6, completed: true })],
    ];
    expect(totalCompletedReps(lists)).toBe(21);
  });

  it("returns 0 for no lists or nothing completed", () => {
    expect(totalCompletedReps([])).toBe(0);
    expect(totalCompletedReps([[set({ reps: 12, completed: false })]])).toBe(0);
  });
});
