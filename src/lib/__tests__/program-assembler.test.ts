import { describe, it, expect } from "vitest";
import { assembleProgram } from "@/lib/program-assembler";
import type { Skeleton, PhaseVariety } from "@/lib/program-schema";

// A 28-day, 2-phase program on a 3-day rotating cycle [Upper, Lower, Rest].
// Phase 1 = weeks 1-2, phase 2 = weeks 3-4 (week 4 deloads). Upper has a barbell
// anchor (Bench Press, load climbs weekly); Lower has a bodyweight anchor (Pistol
// Squat, no load). The cycle is NOT weekday-pinned — it just repeats.
const skeleton: Skeleton = {
  name: "Test Build",
  durationWeeks: 4,
  durationDays: 28,
  deloadWeeks: [4],
  deloadLoadFactor: 0.9,
  workouts: [
    {
      label: "Upper",
      muscleGroups: ["Chest", "Back"],
      anchorLifts: [
        {
          name: "Bench Press",
          muscleGroups: ["Chest"],
          exerciseType: "weight_reps",
          isAssisted: false,
          restSeconds: 180,
          progression: {
            scheme: "linear",
            startLoadLbs: 135,
            incrementLbs: 5,
            sets: 4,
            reps: "5",
          },
        },
      ],
    },
    {
      label: "Lower",
      muscleGroups: ["Legs"],
      anchorLifts: [
        {
          name: "Pistol Squat",
          muscleGroups: ["Legs"],
          exerciseType: "weight_reps",
          isAssisted: false,
          restSeconds: 120,
          progression: {
            scheme: "linear",
            startLoadLbs: 0, // bodyweight anchor
            incrementLbs: 0,
            sets: 3,
            reps: "8",
          },
        },
      ],
    },
  ],
  cycle: [0, 1, -1], // Upper, Lower, Rest
  phases: [
    { name: "Foundation", focus: "hypertrophy", startWeek: 1, endWeek: 2 },
    { name: "Strength", focus: "strength", startWeek: 3, endWeek: 4 },
  ],
};

const foundationVariety: PhaseVariety = {
  days: [
    {
      label: "Upper",
      workoutName: "Upper Hypertrophy",
      accessories: [
        { name: "Incline DB Press", muscleGroups: ["Chest"], exerciseType: "weight_reps", sets: 3, reps: "8-12", rest: 90, notes: "" },
      ],
    },
    {
      label: "Lower",
      workoutName: "Lower Hypertrophy",
      accessories: [
        { name: "Leg Curl", muscleGroups: ["Hamstrings"], exerciseType: "weight_reps", sets: 3, reps: "12-15", rest: 60 },
      ],
    },
  ],
};

const strengthVariety: PhaseVariety = {
  days: [
    { label: "Upper", workoutName: "Upper Power", accessories: [] },
    { label: "Lower", workoutName: "Lower Power", accessories: [] },
  ],
};

describe("assembleProgram", () => {
  const program = assembleProgram({
    skeleton,
    variety: [foundationVariety, strengthVariety],
  });
  // 1-indexed day helper (program.days is 0-indexed; each carries its dayIndex).
  const day = (n: number) => program.days[n - 1];

  it("produces a flat day sequence spanning the program with 1-indexed dayIndex", () => {
    expect(program.days).toHaveLength(28);
    expect(program.cycleLength).toBe(3);
    expect(day(1).dayIndex).toBe(1);
    expect(day(28).dayIndex).toBe(28);
  });

  it("rotates the cycle Upper, Lower, Rest and repeats it (not weekday-pinned)", () => {
    expect(day(1).isRest).toBe(false);
    expect(day(1).exercises[0].name).toBe("Bench Press"); // Upper
    expect(day(2).isRest).toBe(false);
    expect(day(2).exercises[0].name).toBe("Pistol Squat"); // Lower
    expect(day(3).isRest).toBe(true);
    expect(day(3).exercises).toHaveLength(0);
    // cycle repeats: day 4 is Upper again, day 6 rest
    expect(day(4).exercises[0].name).toBe("Bench Press");
    expect(day(6).isRest).toBe(true);
  });

  it("surfaces the deterministic per-week load as targetLoadLbs, climbing by the calendar week the day falls in", () => {
    // Upper falls on days 1 (wk1), 10 (wk2), 16 (wk3), 22 (wk4 deload).
    expect(day(1).exercises[0].targetLoadLbs).toBe(135);
    expect(day(10).exercises[0].targetLoadLbs).toBe(140);
    expect(day(16).exercises[0].targetLoadLbs).toBe(145);
    expect(day(22).exercises[0].targetLoadLbs).toBe(130.5); // 145 * 0.9 deload
  });

  it("omits targetLoadLbs on bodyweight anchors (load 0)", () => {
    expect(day(2).exercises[0].name).toBe("Pistol Squat");
    expect(day(2).exercises[0].targetLoadLbs).toBeUndefined();
  });

  it("interleaves the phase's accessories after the anchors and uses the phase workout name", () => {
    expect(day(1).workoutName).toBe("Upper Hypertrophy");
    expect(day(1).exercises.map((e) => e.name)).toEqual([
      "Bench Press",
      "Incline DB Press",
    ]);
  });

  it("switches to the right phase's variety as weeks advance", () => {
    // day 16 is Upper in week 3 (Strength phase, no accessories).
    expect(day(16).workoutName).toBe("Upper Power");
    expect(day(16).exercises.map((e) => e.name)).toEqual(["Bench Press"]);
  });

  it("tags the deload week note on anchors", () => {
    expect(day(22).exercises[0].notes).toContain("Deload");
  });

  it("falls back to the workout label when a phase has no variety (null)", () => {
    const anchorsOnly = assembleProgram({ skeleton, variety: [null, null] });
    expect(anchorsOnly.days[0].workoutName).toBe("Upper"); // label fallback
    expect(anchorsOnly.days[0].exercises.map((e) => e.name)).toEqual([
      "Bench Press",
    ]); // anchors only
  });

  it("treats -1 or out-of-range cycle slots as rest days", () => {
    const withStrayIndex = assembleProgram({
      skeleton: { ...skeleton, cycle: [0, 99] }, // 99 is out of range
      variety: [foundationVariety, strengthVariety],
    });
    expect(withStrayIndex.days[0].isRest).toBe(false); // workout 0
    expect(withStrayIndex.days[1].isRest).toBe(true); // stray index -> rest
  });
});
