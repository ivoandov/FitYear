import { describe, it, expect } from "vitest";
import {
  MAX_DOCUMENT,
  MAX_NOTE,
  cycleLengthFor,
  entriesFor,
  isCalendarDay,
  parseProgramRequest,
} from "@/lib/integration-program";

const TODAY = "2026-09-23";

const valid = (over: Record<string, unknown> = {}) => ({
  routine: {
    name: "  Knee block, 4 days  ",
    days: [
      {
        dayIndex: 1,
        workoutName: "Upper A",
        exercises: [{ name: "Neutral Grip Pull-ups", sets: 4, reps: "6-8", rest: 150 }],
      },
      {
        dayIndex: 3,
        workoutName: "Lower A",
        exercises: [{ name: "Spanish Squat", sets: 5, reps: "45s", notes: "70% effort" }],
      },
    ],
  },
  start: { startDate: "2026-09-28", durationDays: 56 },
  ...over,
});

describe("what it REFUSES", () => {
  it("a day that appears twice", () => {
    const body = valid();
    (body.routine.days as Array<{ dayIndex: number }>)[1].dayIndex = 1;
    const r = parseProgramRequest(body, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("dayIndex 1 appears twice");
  });

  it("a start in the past", () => {
    const r = parseProgramRequest(valid({ start: { startDate: "2026-09-22", durationDays: 7 } }), TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("before today");
  });

  it("a date that matches the pattern and is not a day", () => {
    const r = parseProgramRequest(valid({ start: { startDate: "2026-02-31", durationDays: 7 } }), TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("not a calendar day");
    expect(isCalendarDay("2026-02-31")).toBe(false);
    expect(isCalendarDay("2026-02-28")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-13-01")).toBe(false);
  });

  it("a day with no exercises, and a routine with no days", () => {
    const noExercises = valid();
    (noExercises.routine.days as Array<{ exercises: unknown[] }>)[0].exercises = [];
    expect(parseProgramRequest(noExercises, TODAY).ok).toBe(false);
    const noDays = valid();
    (noDays.routine as { days: unknown[] }).days = [];
    expect(parseProgramRequest(noDays, TODAY).ok).toBe(false);
  });

  it("a dayIndex outside the rotation, sets outside 1..10, empty reps", () => {
    for (const bad of [0, 15]) {
      const b = valid();
      (b.routine.days as Array<{ dayIndex: number }>)[0].dayIndex = bad;
      expect(parseProgramRequest(b, TODAY).ok, `dayIndex ${bad}`).toBe(false);
    }
    for (const bad of [0, 11]) {
      const b = valid();
      (b.routine.days[0].exercises as Array<{ sets: number }>)[0].sets = bad;
      expect(parseProgramRequest(b, TODAY).ok, `sets ${bad}`).toBe(false);
    }
    const b = valid();
    (b.routine.days[0].exercises as Array<{ reps: string }>)[0].reps = "  ";
    expect(parseProgramRequest(b, TODAY).ok).toBe(false);
  });

  it("a duration of zero days or more than a year", () => {
    expect(parseProgramRequest(valid({ start: { startDate: "2026-09-28", durationDays: 0 } }), TODAY).ok).toBe(false);
    expect(parseProgramRequest(valid({ start: { startDate: "2026-09-28", durationDays: 367 } }), TODAY).ok).toBe(false);
  });

  it("a document or a note past its ceiling", () => {
    const doc = valid({ document: { title: "Constraints", content: "x".repeat(MAX_DOCUMENT + 1) } });
    expect(parseProgramRequest(doc, TODAY).ok).toBe(false);
    const note = valid({ note: "x".repeat(MAX_NOTE + 1) });
    expect(parseProgramRequest(note, TODAY).ok).toBe(false);
  });

  it("a body that is not an object, and says where it went wrong", () => {
    const r = parseProgramRequest(null, TODAY);
    expect(r.ok).toBe(false);
    const r2 = parseProgramRequest({ routine: { name: "x", days: [] } }, TODAY);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.why).toMatch(/^routine\.days|^start/);
  });
});

describe("what it accepts", () => {
  it("a minimal program, trimmed, with reps kept as text", () => {
    const r = parseProgramRequest(valid(), TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.routine.name).toBe("Knee block, 4 days");
    expect(r.request.routine.days[0].exercises[0].reps).toBe("6-8");
    expect(r.request.start.startDate).toBe("2026-09-28");
  });

  it("a start on today itself", () => {
    expect(parseProgramRequest(valid({ start: { startDate: TODAY, durationDays: 7 } }), TODAY).ok).toBe(true);
  });

  it("dryRun and endActive are plain booleans, absent by default", () => {
    const r = parseProgramRequest(valid({ dryRun: true, endActive: true }), TODAY);
    expect(r.ok && r.request.dryRun).toBe(true);
    const r2 = parseProgramRequest(valid(), TODAY);
    expect(r2.ok && r2.request.endActive).toBeUndefined();
  });
});

describe("the rotation and the rows", () => {
  it("days inside one week rotate weekly; into a second week, fortnightly", () => {
    expect(cycleLengthFor([{ dayIndex: 1 }, { dayIndex: 6 }])).toBe(7);
    expect(cycleLengthFor([{ dayIndex: 1 }, { dayIndex: 9 }])).toBe(14);
  });

  it("entries come out in rotation order, inline, through the reconciler, with optionals omitted", () => {
    const r = parseProgramRequest(valid(), TODAY);
    if (!r.ok) throw new Error(r.why);
    const days = [r.request.routine.days[1], r.request.routine.days[0]];
    const rows = entriesFor(days, (n) => `<${n}>`);
    expect(rows.map((x) => x.dayIndex)).toEqual([1, 3]);
    expect(rows[0].workoutTemplateId).toBeNull();
    expect(rows[0].exercises[0].name).toBe("<Neutral Grip Pull-ups>");
    expect(rows[0].exercises[0]).toEqual({ name: "<Neutral Grip Pull-ups>", sets: 4, reps: "6-8", rest: 150 });
    expect(Object.keys(rows[1].exercises[0])).toEqual(["name", "sets", "reps", "notes"]);
  });
});
