import { describe, it, expect } from "vitest";
import {
  EPLEY_MAX_REPS,
  beatsHold,
  calcStreak,
  deriveWorkoutName,
  detectPRs,
  epley1RM,
  isRepTotalExercise,
  prSetIndices,
  summarizeWorkout,
  totalCompletedReps,
  type ExerciseInWorkout,
  type SetData,
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
      // The one-word house spelling the catalog uses now. "pushdown" must not
      // read as a push-up just because it starts with the same four letters.
      "Cable Lat Pulldown",
      "Bar Pushdowns",
      "Cable Pushdown",
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

describe("summarizeWorkout counting", () => {
  it("counts only completed sets and only exercises that were trained", () => {
    const summary = summarizeWorkout({
      exercises: [
        ex({
          muscleGroups: ["Chest"],
          setsData: [
            set({ weight: 100, reps: 10, completed: true }),
            // Abandoned row carrying prefilled values - must not count.
            set({ weight: 100, reps: 10, completed: false }),
          ],
        }),
        // Opened but never logged: not a trained exercise.
        ex({ muscleGroups: ["Back"], setsData: [set({ weight: 50, reps: 5 })] }),
      ],
      completedAt: new Date(),
      startedAt: null,
      durationSeconds: 600,
    });
    expect(summary.totalSets).toBe(1);
    expect(summary.totalVolumeLbs).toBe(1000);
    expect(summary.exerciseCount).toBe(1);
    expect(summary.muscleGroups.get("Back")).toBeUndefined();
  });
});

describe("epley1RM", () => {
  it("returns the weight itself at one rep", () => {
    expect(epley1RM(300, 1)).toBe(300);
  });

  it("clamps reps so a high-rep set cannot fabricate a huge 1RM", () => {
    // 95 x 40 read 221.7 lb before the clamp; it now matches 95 x 12.
    expect(epley1RM(95, 40)).toBeCloseTo(epley1RM(95, EPLEY_MAX_REPS), 6);
    expect(epley1RM(95, 40)).toBeLessThan(140);
  });

  it("is zero for non-positive input", () => {
    expect(epley1RM(0, 5)).toBe(0);
    expect(epley1RM(100, 0)).toBe(0);
  });
});

describe("detectPRs epsilon", () => {
  const ex = (weight: number, reps: number) => ({
    exercises: [
      {
        id: "e1",
        name: "Bench",
        setsData: [{ weight, reps, completed: true }],
      },
    ],
  });

  it("ignores a kg round-trip drift instead of firing a phantom weight PR", () => {
    // 100 lb -> 45.4 kg -> 100.1 lb: unchanged work, not a record.
    const hits = detectPRs(ex(100.1, 10), [ex(100, 10)], new Map([["e1", false]]));
    expect(hits.filter((h) => h.type === "weight")).toHaveLength(0);
  });

  it("scales the volume epsilon by reps so drift x reps is not a PR", () => {
    // 100.1 x 10 = 1001 vs 1000 exceeds a flat 0.25 margin but is still drift.
    const hits = detectPRs(ex(100.1, 10), [ex(100, 10)], new Map([["e1", false]]));
    expect(hits.filter((h) => h.type === "volume")).toHaveLength(0);
  });

  it("still reports a genuine improvement", () => {
    const hits = detectPRs(ex(105, 10), [ex(100, 10)], new Map([["e1", false]]));
    expect(hits.some((h) => h.type === "weight")).toBe(true);
  });
});

describe("prSetIndices - the badge follows the CURRENT sets", () => {
  const s = (weight: number, reps: number, completed = true) => ({ weight, reps, time: 0, completed });

  it("keeps the badge only on the top set when working up in weight", () => {
    // Ivo, 2026-08-28: "if I do a set and I get a PR at say 5lbs, then another
    // set at 10lbs next, the PR should really only be kept for the second set."
    const marks = prSetIndices([s(5, 5), s(10, 5)], 4, 20, false);
    expect(marks.has(1)).toBe(true);
    expect(marks.has(0)).toBe(false);
  });

  it("drops the badge when a mistyped weight is corrected back down", () => {
    // The other half of the same report: entering 10 by mistake against a 5 lb
    // best set a PR, and editing it back to 5 used to leave the badge behind.
    const before = prSetIndices([s(10, 5)], 5, 25, false);
    expect(before.has(0)).toBe(true);
    const after = prSetIndices([s(5, 5)], 5, 25, false);
    expect(after.size).toBe(0);
  });

  it("ignores sets that are not completed", () => {
    expect(prSetIndices([s(100, 5, false)], 10, 50, false).size).toBe(0);
  });

  it("ignores zero-weight and zero-rep rows", () => {
    expect(prSetIndices([s(0, 5), s(100, 0)], undefined, undefined, false).size).toBe(0);
  });

  it("marks a first-ever set with no history", () => {
    expect(prSetIndices([s(45, 5)], undefined, undefined, false).has(0)).toBe(true);
  });

  it("does not mark a set that only matches the historical best", () => {
    expect(prSetIndices([s(100, 5)], 100, 500, false).size).toBe(0);
  });

  it("keeps the EARLIEST set on a tie, because a later match did not beat it", () => {
    const marks = prSetIndices([s(50, 5), s(50, 5)], 40, 200, false);
    expect(marks.has(0)).toBe(true);
    expect(marks.has(1)).toBe(false);
  });

  it("can mark two different sets when weight and volume peak apart", () => {
    // A heavy single and a high-volume set are genuinely separate records.
    const marks = prSetIndices([s(100, 1), s(50, 20)], 90, 900, false);
    expect(marks.has(0)).toBe(true); // weight
    expect(marks.has(1)).toBe(true); // volume
  });

  it("INVERTS for assisted lifts and skips volume entirely", () => {
    // Less counterweight is harder, so the lightest assist is the record.
    const marks = prSetIndices([s(50, 5), s(30, 5)], 60, undefined, true);
    expect(marks.has(1)).toBe(true);
    expect(marks.has(0)).toBe(false);
    expect(marks.size).toBe(1); // no volume badge
  });

  it("respects the kg round-trip epsilon", () => {
    // 100 lb re-logged by a kg user comes back as ~100.1 and must not badge.
    expect(prSetIndices([s(100.1, 5)], 100, 500, false).has(0)).toBe(false);
  });
});

describe("hold PRs - a duration axis for weight_time", () => {
  const hold = (sets: Array<{ w: number; t: number; done?: boolean }>) => ({
    id: "h",
    name: "Plate Pinch",
    exerciseType: "weight_time",
    setsData: sets.map((s, i) => ({
      setNumber: i + 1, weight: s.w, reps: 0, distance: 0, time: s.t,
      completed: s.done !== false,
    })),
  });

  it("beatsHold requires no LESS weight than the previous best", () => {
    // 5 lb for 90s is easier than 25 lb for 60s. Badging it would reward
    // going lighter, which is the opposite of progress.
    expect(beatsHold(90, 5, { seconds: 60, weightLbs: 25 })).toBe(false);
    expect(beatsHold(75, 25, { seconds: 60, weightLbs: 25 })).toBe(true);
    expect(beatsHold(75, 30, { seconds: 60, weightLbs: 25 })).toBe(true);
  });

  it("reduces to 'longer than before' for a BODYWEIGHT hold", () => {
    // Weight is 0 on both sides, so only the clock matters.
    expect(beatsHold(50, 0, { seconds: 45, weightLbs: 0 })).toBe(true);
    expect(beatsHold(40, 0, { seconds: 45, weightLbs: 0 })).toBe(false);
  });

  it("counts a first-ever hold, and never a zero-length one", () => {
    expect(beatsHold(30, 0, undefined)).toBe(true);
    expect(beatsHold(0, 25, undefined)).toBe(false);
  });

  it("detectPRs reports a hold PR at ZERO weight, which the weight rules skip", () => {
    // A bodyweight hang is weight 0; the lift rules discard those rows, so
    // before this a hang could never register a record at all.
    const hits = detectPRs(
      { exercises: [hold([{ w: 0, t: 60 }])] },
      [{ exercises: [hold([{ w: 0, t: 45 }])] }],
    );
    expect(hits).toEqual([
      { exerciseId: "h", exerciseName: "Plate Pinch", type: "time", newValue: 60, previousValue: 45 },
    ]);
  });

  it("detectPRs gives a hold NO weight or volume PR", () => {
    // A hold has no reps, so volume is meaningless, and its record is the clock.
    const hits = detectPRs(
      { exercises: [hold([{ w: 25, t: 60 }])] },
      [{ exercises: [hold([{ w: 5, t: 90 }])] }],
    );
    expect(hits.map((h) => h.type)).toEqual([]);
  });

  it("prSetIndices badges the LONGEST hold only", () => {
    const marks = prSetIndices(
      [
        { weight: 25, reps: 0, time: 40, completed: true },
        { weight: 25, reps: 0, time: 65, completed: true },
      ],
      undefined, undefined, false,
      { previousBest: { seconds: 60, weightLbs: 25 } },
    );
    expect(marks.has(1)).toBe(true);
    expect(marks.has(0)).toBe(false);
  });

  it("prSetIndices drops the badge when a hold is corrected back down", () => {
    const prev = { previousBest: { seconds: 60, weightLbs: 25 } };
    const before = prSetIndices([{ weight: 25, reps: 0, time: 90, completed: true }], undefined, undefined, false, prev);
    expect(before.has(0)).toBe(true);
    const after = prSetIndices([{ weight: 25, reps: 0, time: 30, completed: true }], undefined, undefined, false, prev);
    expect(after.size).toBe(0);
  });
})
