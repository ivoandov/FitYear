import { describe, it, expect } from "vitest";
import { assembleProgram } from "@/lib/program-assembler";
import type { Skeleton, PhaseVariety } from "@/lib/program-schema";

// A 4-week, 2-phase upper/lower skeleton: phase 1 (weeks 1-2), phase 2
// (weeks 3-4, week 4 deloads). Monday = Upper (barbell anchor), Tuesday =
// Lower (bodyweight anchor).
const skeleton: Skeleton = {
  name: "Test Build",
  durationWeeks: 4,
  daysPerWeek: 2,
  deloadWeeks: [4],
  deloadLoadFactor: 0.9,
  phases: [
    { name: "Foundation", focus: "hypertrophy", startWeek: 1, endWeek: 2 },
    { name: "Strength", focus: "strength", startWeek: 3, endWeek: 4 },
  ],
  split: [
    {
      dayLabel: "Upper",
      dayOfWeek: "Monday",
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
      dayLabel: "Lower",
      dayOfWeek: "Tuesday",
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
};

const foundationVariety: PhaseVariety = {
  days: [
    {
      dayLabel: "Upper",
      workoutName: "Upper Hypertrophy",
      accessories: [
        { name: "Incline DB Press", muscleGroups: ["Chest"], exerciseType: "weight_reps", sets: 3, reps: "8-12", rest: 90, notes: "" },
      ],
    },
    {
      dayLabel: "Lower",
      workoutName: "Lower Hypertrophy",
      accessories: [
        { name: "Leg Curl", muscleGroups: ["Hamstrings"], exerciseType: "weight_reps", sets: 3, reps: "12-15", rest: 60 },
      ],
    },
  ],
};

const strengthVariety: PhaseVariety = {
  days: [
    { dayLabel: "Upper", workoutName: "Upper Power", accessories: [] },
    { dayLabel: "Lower", workoutName: "Lower Power", accessories: [] },
  ],
};

describe("assembleProgram", () => {
  const program = assembleProgram({
    skeleton,
    variety: [foundationVariety, strengthVariety],
  });

  it("produces one entry per week, each a full 7-day week", () => {
    expect(program.weeks).toHaveLength(4);
    for (const week of program.weeks) expect(week.days).toHaveLength(7);
  });

  it("marks only the split's weekdays as training and the rest as rest days", () => {
    const w1 = program.weeks[0];
    const byDow = Object.fromEntries(w1.days.map((d) => [d.dayOfWeek, d]));
    expect(byDow["Monday"].isRest).toBe(false);
    expect(byDow["Tuesday"].isRest).toBe(false);
    expect(byDow["Wednesday"].isRest).toBe(true);
    expect(byDow["Sunday"].isRest).toBe(true);
    expect(byDow["Wednesday"].exercises).toHaveLength(0);
  });

  it("surfaces the deterministic per-week load as targetLoadLbs on weight anchors", () => {
    const mondays = program.weeks.map(
      (w) => w.days.find((d) => d.dayOfWeek === "Monday")!,
    );
    const benchLoads = mondays.map((d) => d.exercises[0].targetLoadLbs);
    // wk1 135, wk2 140, wk3 145, wk4 deload (145 * 0.9 = 130.5)
    expect(benchLoads).toEqual([135, 140, 145, 130.5]);
  });

  it("omits targetLoadLbs on bodyweight anchors (load 0)", () => {
    const tue1 = program.weeks[0].days.find((d) => d.dayOfWeek === "Tuesday")!;
    expect(tue1.exercises[0].name).toBe("Pistol Squat");
    expect(tue1.exercises[0].targetLoadLbs).toBeUndefined();
  });

  it("interleaves the phase's accessories after the anchors and uses the phase workout name", () => {
    const mon1 = program.weeks[0].days.find((d) => d.dayOfWeek === "Monday")!;
    expect(mon1.workoutName).toBe("Upper Hypertrophy");
    expect(mon1.exercises.map((e) => e.name)).toEqual([
      "Bench Press",
      "Incline DB Press",
    ]);
  });

  it("switches to the right phase's variety as weeks advance", () => {
    const mon3 = program.weeks[2].days.find((d) => d.dayOfWeek === "Monday")!;
    expect(mon3.workoutName).toBe("Upper Power"); // phase 2
    expect(mon3.exercises.map((e) => e.name)).toEqual(["Bench Press"]); // no accessories
  });

  it("tags the deload week note on anchors", () => {
    const mon4 = program.weeks[3].days.find((d) => d.dayOfWeek === "Monday")!;
    expect(mon4.exercises[0].notes).toContain("Deload");
  });

  it("falls back to the split dayLabel when a phase has no variety (null)", () => {
    const anchorsOnly = assembleProgram({ skeleton, variety: [null, null] });
    const mon1 = anchorsOnly.weeks[0].days.find((d) => d.dayOfWeek === "Monday")!;
    expect(mon1.workoutName).toBe("Upper"); // dayLabel fallback
    expect(mon1.exercises.map((e) => e.name)).toEqual(["Bench Press"]); // anchors only
  });

  it("normalizes abbreviated weekday names onto full weekdays", () => {
    const abbrev: Skeleton = {
      ...skeleton,
      split: skeleton.split.map((d) => ({
        ...d,
        dayOfWeek: d.dayOfWeek === "Monday" ? "Mon" : "Tues",
      })),
    };
    const prog = assembleProgram({ skeleton: abbrev, variety: [foundationVariety, strengthVariety] });
    const w1 = prog.weeks[0];
    expect(w1.days.find((d) => d.dayOfWeek === "Monday")!.isRest).toBe(false);
    expect(w1.days.find((d) => d.dayOfWeek === "Tuesday")!.isRest).toBe(false);
  });
});
