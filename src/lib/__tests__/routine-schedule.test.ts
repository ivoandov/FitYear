import { describe, it, expect } from "vitest";
import { cyclePeriodFor, expandRoutineSchedule, isExpandedProgram, programWeekFor } from "@/lib/routine-schedule";

/** A 3-day week: train Mon, Wed, Fri, with the gaps as rest. */
const WEEKLY = [{ dayIndex: 1 }, { dayIndex: 3 }, { dayIndex: 5 }];

describe("working out the cycle period", () => {
  it("floors a short training week at 7 days", () => {
    // Training on days 1, 3 and 5 is a WEEKLY routine with rest gaps. Treating
    // the period as 5 would drift every session two days earlier each repeat
    // until the routine no longer lands on the days somebody chose.
    expect(cyclePeriodFor(WEEKLY)).toBe(7);
  });

  it("rounds a longer hand-built span up to whole weeks", () => {
    // The hand editor lays routines out in weeks, so a routine reaching day 9
    // is a two-week routine, not a 9-day cycle.
    expect(cyclePeriodFor([{ dayIndex: 1 }, { dayIndex: 9 }])).toBe(14);
    expect(cyclePeriodFor([{ dayIndex: 1 }, { dayIndex: 14 }])).toBe(14);
  });

  it("a four-week routine ending on day 27 repeats every 28 days, not 27", () => {
    // The bug this guards: with the bare span as the period, day 1 landed
    // again on day 28, and every later pass ran a day earlier than built.
    const fourWeeks = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 27].map((dayIndex) => ({ dayIndex }));
    const out = expandRoutineSchedule(fourWeeks, { startKey: "2026-09-21", durationDays: 56 });
    expect(out).toHaveLength(24);
    expect(out.filter((o) => o.dateKey === "2026-10-18")).toEqual([]); // day 28 stays a rest day
    expect(out[12].dateKey).toBe("2026-10-19"); // second pass starts on day 29
    expect(out[12].entry.dayIndex).toBe(1);
  });

  it("a hand-built cycle still repeats across a longer duration", () => {
    const out = expandRoutineSchedule([{ dayIndex: 1 }, { dayIndex: 10 }], {
      startKey: "2026-09-21",
      durationDays: 30,
    });
    // Two-week period: days 1, 10, 15, 24, 29.
    expect(out.map((o) => o.dateKey)).toEqual([
      "2026-09-21",
      "2026-09-30",
      "2026-10-05",
      "2026-10-14",
      "2026-10-19",
    ]);
  });

  it("prefers an explicit cycleLength", () => {
    // Only ai/save-program writes that column, from the program's own rotation,
    // so it outranks anything inferred.
    expect(cyclePeriodFor(WEEKLY, 10)).toBe(10);
  });
});

describe("repeating a short routine across the duration", () => {
  it("repeats a 3-day week for four weeks", () => {
    const out = expandRoutineSchedule(WEEKLY, {
      startKey: "2026-09-21",
      durationDays: 28,
    });
    // Three sessions a week for four weeks. Before this, starting a routine
    // "for 4 weeks" created THREE sessions and the other 25 days were empty.
    expect(out).toHaveLength(12);
  });

  it("puts each repeat exactly one period later", () => {
    const out = expandRoutineSchedule(WEEKLY, {
      startKey: "2026-09-21",
      durationDays: 21,
    });
    expect(out[0].dateKey).toBe("2026-09-21"); // day 1
    expect(out[1].dateKey).toBe("2026-09-23"); // day 3
    expect(out[2].dateKey).toBe("2026-09-25"); // day 5
    expect(out[3].dateKey).toBe("2026-09-28"); // day 8, one week on
  });

  it("never schedules past the duration", () => {
    // The progress denominator and the end date both come from this, so a
    // session beyond the program would make a routine impossible to finish.
    const out = expandRoutineSchedule(WEEKLY, {
      startKey: "2026-09-21",
      durationDays: 10,
    });
    expect(out).toHaveLength(5); // days 1,3,5 then 8,10
    expect(out.every((o) => o.dateKey <= "2026-09-30")).toBe(true);
  });

  it("numbers weeks by the CALENDAR, which is what a progression rule means", () => {
    const out = expandRoutineSchedule(WEEKLY, {
      startKey: "2026-09-21",
      durationDays: 21,
    });
    expect(out[0].week).toBe(1); // day 1
    expect(out[3].week).toBe(2); // day 8
    expect(out[6].week).toBe(3); // day 15
  });
});

describe("leaving a full-length program alone", () => {
  // FitBot emits a FLAT list: week five's session is its own entry at an
  // absolute dayIndex, already carrying its own computed target load. It also
  // always sets cycleLength, which is the ROTATION period (7 here) and not the
  // program length - so entries reaching day 31 are past one rotation.
  const PROGRAM = [{ dayIndex: 1 }, { dayIndex: 3 }, { dayIndex: 29 }, { dayIndex: 31 }];

  it("does NOT repeat a program whose entries reach past one rotation", () => {
    const out = expandRoutineSchedule(PROGRAM, {
      startKey: "2026-09-21",
      durationDays: 35,
      cycleLength: 7,
    });
    // Four entries in, four sessions out. Repeating would have duplicated the
    // entire program on top of itself.
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.entry.dayIndex)).toEqual([1, 3, 29, 31]);
  });

  it("still drops entries beyond a shortened duration", () => {
    const out = expandRoutineSchedule(PROGRAM, {
      startKey: "2026-09-21",
      durationDays: 30,
      cycleLength: 7,
    });
    expect(out.map((o) => o.entry.dayIndex)).toEqual([1, 3, 29]);
  });
});

describe("refusing to produce nonsense", () => {
  it("returns nothing for no entries", () => {
    expect(expandRoutineSchedule([], { startKey: "2026-09-21", durationDays: 28 })).toEqual([]);
  });

  it("returns nothing for a zero or negative duration", () => {
    expect(expandRoutineSchedule(WEEKLY, { startKey: "2026-09-21", durationDays: 0 })).toEqual([]);
  });

  it("ignores an entry with a bad dayIndex rather than scheduling it", () => {
    const out = expandRoutineSchedule(
      [{ dayIndex: 0 }, { dayIndex: -3 }, { dayIndex: 2 }],
      { startKey: "2026-09-21", durationDays: 7 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].entry.dayIndex).toBe(2);
  });

  it("carries the caller's own fields through untouched", () => {
    // The route needs workoutName, exercises and templateId on the far side.
    const out = expandRoutineSchedule(
      [{ dayIndex: 1, workoutName: "Push", exercises: [{ name: "Bench" }] }],
      { startKey: "2026-09-21", durationDays: 7 },
    );
    expect(out[0].entry.workoutName).toBe("Push");
    expect(out[0].entry.exercises).toEqual([{ name: "Bench" }]);
  });
});

describe("telling a full program from one cycle", () => {
  it("a FitBot build reaching past its rotation is already expanded", () => {
    // Its loads have already climbed, so a progression rule must not touch it.
    expect(isExpandedProgram([{ dayIndex: 1 }, { dayIndex: 3 }, { dayIndex: 29 }], 7)).toBe(true);
  });

  it("a manual weekly routine is one cycle", () => {
    expect(isExpandedProgram(WEEKLY)).toBe(false);
    expect(isExpandedProgram(WEEKLY, 7)).toBe(false);
  });

  it("a routine with no usable entries is not a program", () => {
    expect(isExpandedProgram([])).toBe(false);
  });
});

describe("the week a session falls in", () => {
  it("matches the week expandRoutineSchedule assigns", () => {
    // The re-sync only has a session's DATE, and must land on the same week
    // the start route used when it created that session.
    const out = expandRoutineSchedule(WEEKLY, { startKey: "2026-09-21", durationDays: 28 });
    for (const o of out) expect(programWeekFor("2026-09-21", o.dateKey)).toBe(o.week);
  });

  it("counts calendar weeks from the start day", () => {
    expect(programWeekFor("2026-09-21", "2026-09-21")).toBe(1);
    expect(programWeekFor("2026-09-21", "2026-09-27")).toBe(1);
    expect(programWeekFor("2026-09-21", "2026-09-28")).toBe(2);
  });

  it("never reports a week before the first", () => {
    expect(programWeekFor("2026-09-21", "2026-09-01")).toBe(1);
  });
});
