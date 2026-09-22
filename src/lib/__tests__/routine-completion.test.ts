import { describe, it, expect } from "vitest";
import { hasRunItsCourse, hasRunOutOfDays } from "@/lib/routine-completion";

describe("hasRunItsCourse", () => {
  it("ends a program when every planned session is done", () => {
    expect(hasRunItsCourse({ completedWorkouts: 5, skippedWorkouts: 0, totalWorkouts: 5 })).toBe(true);
  });

  it("counts a skip as accounted for, not as a debt", () => {
    // A skip is a decision about that session. Requiring completions alone
    // would leave a program active with nothing left in it to do.
    expect(hasRunItsCourse({ completedWorkouts: 4, skippedWorkouts: 1, totalWorkouts: 5 })).toBe(true);
  });

  it("keeps a program running while sessions remain", () => {
    expect(hasRunItsCourse({ completedWorkouts: 3, skippedWorkouts: 0, totalWorkouts: 5 })).toBe(false);
  });

  it("survives past the total, which the counters can do", () => {
    // completedWorkouts is hand-maintained and a routine edit can lower the
    // total underneath it, so "equals" would miss the case that matters.
    expect(hasRunItsCourse({ completedWorkouts: 7, skippedWorkouts: 0, totalWorkouts: 5 })).toBe(true);
  });

  it("never ends a program whose total is missing or zero", () => {
    // A zero total would otherwise read as "all done" the moment it is created,
    // retiring a program before its first session.
    expect(hasRunItsCourse({ completedWorkouts: 0, skippedWorkouts: 0, totalWorkouts: 0 })).toBe(false);
    expect(hasRunItsCourse({ completedWorkouts: 0, skippedWorkouts: 0, totalWorkouts: null })).toBe(false);
    expect(hasRunItsCourse({ completedWorkouts: null, skippedWorkouts: null, totalWorkouts: null })).toBe(false);
  });
});

describe("hasRunOutOfDays", () => {
  it("ends a program whose last day has passed with nothing scheduled", () => {
    expect(
      hasRunOutOfDays({ endDateKey: "2026-09-02", todayKey: "2026-09-22", upcomingSessions: 0 }),
    ).toBe(true);
  });

  it("keeps a program that still has a session on the calendar", () => {
    // The dates say it is over and the calendar says it is not. The calendar
    // wins: somebody moved a session out past the end, and it is still theirs
    // to train.
    expect(
      hasRunOutOfDays({ endDateKey: "2026-09-02", todayKey: "2026-09-22", upcomingSessions: 1 }),
    ).toBe(false);
  });

  it("does not end a program on its own last day", () => {
    // Strictly past: today is still today's program, even with nothing left
    // on the calendar after this morning's session.
    expect(
      hasRunOutOfDays({ endDateKey: "2026-09-22", todayKey: "2026-09-22", upcomingSessions: 0 }),
    ).toBe(false);
  });

  it("compares date KEYS, so no timezone can shift the boundary", () => {
    // Same family as a scheduled workout: end_date is a day somebody chose.
    // String comparison of YYYY-MM-DD cannot be moved by a zone or a DST edge.
    expect(
      hasRunOutOfDays({ endDateKey: "2026-12-31", todayKey: "2027-01-01", upcomingSessions: 0 }),
    ).toBe(true);
    expect(
      hasRunOutOfDays({ endDateKey: "2027-01-01", todayKey: "2026-12-31", upcomingSessions: 0 }),
    ).toBe(false);
  });

  it("leaves a program with no end date alone", () => {
    expect(
      hasRunOutOfDays({ endDateKey: null, todayKey: "2026-09-22", upcomingSessions: 0 }),
    ).toBe(false);
  });
});
