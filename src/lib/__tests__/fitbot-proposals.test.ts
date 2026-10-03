import { describe, expect, it } from "vitest";
import {
  describeStart,
  durationWords,
  fieldLabel,
  formatDayKey,
  hasPendingRoutineChange,
  proposalConsequence,
  proposalTitle,
  supersedePending,
  type ProposalLike,
} from "@/lib/fitbot-proposals";

const p = (tool: string, input: Record<string, unknown>, status: ProposalLike["status"] = "pending"): ProposalLike => ({
  tool,
  input,
  status,
});

describe("supersedePending - an outdated card stops being approvable", () => {
  it("retires older versions of the same routine change (Ivo's three routine cards)", () => {
    const thread = [
      p("propose_routine_change", { routineId: "r1" }),
      p("propose_start_routine", { routineId: "r1", startDate: "2026-10-05" }),
      p("propose_routine_change", { routineId: "r1" }),
    ];
    const next = supersedePending(thread, p("propose_routine_change", { routineId: "r1" }));
    expect(next.map((x) => x.status)).toEqual(["superseded", "pending", "superseded"]);
  });

  it("leaves a change to a DIFFERENT routine alone", () => {
    const next = supersedePending([p("propose_routine_change", { routineId: "r1" })], p("propose_routine_change", { routineId: "r2" }));
    expect(next[0].status).toBe("pending");
  });

  it("any newer start replaces any older start: only one program can run", () => {
    const next = supersedePending(
      [p("propose_start_routine", { routineId: "r1", startDate: "2026-10-05" })],
      p("propose_start_routine", { routineId: "r9", startDate: "2026-10-02" }),
    );
    expect(next[0].status).toBe("superseded");
  });

  it("never touches a card that was already decided", () => {
    const thread = [
      p("propose_start_routine", { routineId: "r1" }, "approved"),
      p("propose_start_routine", { routineId: "r1" }, "rejected"),
      p("propose_start_routine", { routineId: "r1" }, "failed"),
    ];
    const next = supersedePending(thread, p("propose_start_routine", { routineId: "r1" }));
    expect(next.map((x) => x.status)).toEqual(["approved", "rejected", "failed"]);
  });

  it("two different workouts to schedule can both stand", () => {
    const next = supersedePending(
      [p("propose_schedule_workout", { name: "Legs", date: "2026-10-05" })],
      p("propose_schedule_workout", { name: "Arms", date: "2026-10-06" }),
    );
    expect(next[0].status).toBe("pending");
  });

  it("a newer edit of the same scheduled session replaces the older, and a delete counts", () => {
    const next = supersedePending(
      [p("propose_update_scheduled_workout", { scheduledWorkoutId: "s1", date: "2026-10-04" })],
      p("propose_delete_scheduled_workout", { scheduledWorkoutId: "s1" }),
    );
    expect(next[0].status).toBe("superseded");
  });
});

describe("hasPendingRoutineChange - a start would schedule the routine as SAVED", () => {
  it("is true while a change to that routine is unapproved", () => {
    expect(hasPendingRoutineChange([p("propose_routine_change", { routineId: "r1" })], "r1")).toBe(true);
  });
  it("is false once it is approved, superseded, or about another routine", () => {
    expect(hasPendingRoutineChange([p("propose_routine_change", { routineId: "r1" }, "approved")], "r1")).toBe(false);
    expect(hasPendingRoutineChange([p("propose_routine_change", { routineId: "r1" }, "superseded")], "r1")).toBe(false);
    expect(hasPendingRoutineChange([p("propose_routine_change", { routineId: "r2" })], "r1")).toBe(false);
  });
});

describe("card wording", () => {
  it("names what each card does, and says a routine change starts nothing", () => {
    expect(proposalTitle("propose_routine_change")).toBe("Update the routine");
    expect(proposalTitle("propose_start_routine")).toBe("Start the program");
    expect(proposalTitle("something_new")).toBe("Proposed change");
    expect(proposalConsequence("propose_routine_change")).toMatch(/does not start a program/);
    expect(proposalConsequence("propose_start_routine")).toBeNull();
  });

  it("writes a day as the day, with its weekday, in any runtime zone", () => {
    expect(formatDayKey("2026-10-02")).toBe("Fri, Oct 2");
    expect(formatDayKey("not a day")).toBe("not a day");
  });

  it("says a length the way a person would", () => {
    expect(durationWords(84)).toBe("12 weeks");
    expect(durationWords(7)).toBe("1 week");
    expect(durationWords(90)).toBe("3 months");
    expect(durationWords(10)).toBe("10 days");
  });

  it("describes Ivo's start: Oct 2 for 12 weeks ends Dec 24", () => {
    expect(describeStart({ startDate: "2026-10-02", durationWeeks: 12 })).toBe(
      "Starts Fri, Oct 2 and runs 12 weeks, through Thu, Dec 24.",
    );
    expect(describeStart({ startDate: "2026-10-02" })).toMatch(/usual length/);
    expect(describeStart({})).toBeNull();
  });

  it("turns a field name into a label", () => {
    expect(fieldLabel("measuredOn")).toBe("Measured on");
    expect(fieldLabel("weightLbs")).toBe("Weight lbs");
  });
});
