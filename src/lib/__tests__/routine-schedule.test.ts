import { describe, it, expect } from "vitest";
import { cyclePeriodFor, expandRoutineSchedule } from "@/lib/routine-schedule";

/** A 3-day week: train Mon, Wed, Fri, with the gaps as rest. */
const WEEKLY = [{ dayIndex: 1 }, { dayIndex: 3 }, { dayIndex: 5 }];

describe("working out the cycle period", () => {
  it("floors a short training week at 7 days", () => {
    // Training on days 1, 3 and 5 is a WEEKLY routine with rest gaps. Treating
    // the period as 5 would drift every session two days earlier each repeat
    // until the routine no longer lands on the days somebody chose.
    expect(cyclePeriodFor(WEEKLY)).toBe(7);
  });

  it("uses a longer span when the routine genuinely has one", () => {
    expect(cyclePeriodFor([{ dayIndex: 1 }, { dayIndex: 9 }])).toBe(9);
  });

  it("a 10-day manual cycle still repeats, since its span equals its period", () => {
    const out = expandRoutineSchedule([{ dayIndex: 1 }, { dayIndex: 10 }], {
      startKey: "2026-09-21",
      durationDays: 30,
    });
    expect(out).toHaveLength(6);
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
