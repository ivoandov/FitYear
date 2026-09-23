import { describe, it, expect } from "vitest";
import {
  DESTINATION,
  EQUIPMENT_OPTIONS,
  FLOW,
  GOAL_OPTIONS,
  LIMIT_OPTIONS,
  buildCoachNotes,
  monthlyGoalFromDaysPerWeek,
} from "@/lib/onboarding";

describe("the flow", () => {
  it("asks the logging user exactly one question", () => {
    // Somebody who said "just let me log my workouts" has told us not to
    // interview them. The weight unit survives only because getting it wrong is
    // visible on every screen afterwards.
    expect(FLOW.track).toEqual(["unit"]);
    expect(FLOW.import).toEqual(["unit"]);
  });

  it("asks the coached user only what nothing else asks", () => {
    // Two rules at once. Nothing here is readable from workout rows, which
    // FitBot can already see. And nothing here is asked AGAIN by the program
    // builder: goal, equipment and limitations moved there, because asking
    // them twice in two visual styles is what Ivo hit running this for real.
    expect(FLOW.coach).toEqual(["unit", "days", "anything"]);
    expect(FLOW.coach).not.toContain("goal");
    expect(FLOW.coach).not.toContain("equipment");
    expect(FLOW.coach).not.toContain("limits");
  });

  it("does not send the logging user to an empty tracker", () => {
    // /track with no active workout renders "No Active Workout - Go to
    // Workouts", so landing there would bounce them straight back. Home is
    // where the start button is.
    expect(DESTINATION.track).toBe("/");
    expect(DESTINATION.coach).toBe("/fit-bot");
    expect(DESTINATION.import).toBe("/import");
  });
});

describe("the derived monthly goal", () => {
  it("scales with days per week instead of defaulting everyone to 16", () => {
    expect(monthlyGoalFromDaysPerWeek(2)).toBe(9);
    expect(monthlyGoalFromDaysPerWeek(3)).toBe(13);
    expect(monthlyGoalFromDaysPerWeek(4)).toBe(17);
    expect(monthlyGoalFromDaysPerWeek(6)).toBe(26);
  });

  it("stays inside what the settings route will accept", () => {
    // The PATCH schema caps this at 31. A value from here must never be the
    // thing that 400s the request that completes onboarding.
    for (let d = 1; d <= 7; d++) {
      const goal = monthlyGoalFromDaysPerWeek(d);
      expect(goal).toBeGreaterThanOrEqual(1);
      expect(goal).toBeLessThanOrEqual(31);
    }
  });
});

describe("turning answers into coach notes", () => {
  it("writes nothing when nothing was answered", () => {
    expect(buildCoachNotes({})).toEqual([]);
  });

  it("files equipment and limitations as CONSTRAINTS, not preferences", () => {
    // constraint is the kind the system prompt renders first and describes as a
    // rule the coach may never propose around. Filing an injury as a preference
    // would make it something the coach is told it may argue with.
    const notes = buildCoachNotes({
      equipmentChip: "Bodyweight only",
      limitChips: ["Shoulder"],
    });
    expect(notes.every((n) => n.kind === "constraint")).toBe(true);
    expect(notes).toHaveLength(2);
  });

  it("files the goal as a goal", () => {
    const notes = buildCoachNotes({ goalChip: "Build muscle" });
    expect(notes).toEqual([{ kind: "goal", content: "Training to build muscle" }]);
  });

  it("stores free text VERBATIM and separately from the chip", () => {
    // "left shoulder, only overhead" is more precise than any chip, and
    // folding it into the chip's sentence would lose the detail that makes it
    // worth having.
    const notes = buildCoachNotes({
      limitChips: ["Shoulder"],
      limitText: "  left shoulder, only overhead  ",
    });
    expect(notes).toHaveLength(2);
    expect(notes[1].content).toBe("left shoulder, only overhead");
  });

  it("ignores blank free text rather than storing an empty note", () => {
    expect(buildCoachNotes({ goalText: "   " })).toEqual([]);
  });

  it("ignores a chip label it does not recognise", () => {
    // The labels come from a client. An unknown one is dropped rather than
    // written through as a note nobody wrote.
    expect(buildCoachNotes({ goalChip: "Become a wizard" })).toEqual([]);
    expect(buildCoachNotes({ limitChips: ["Tail"] })).toEqual([]);
  });

  it("keeps both a chip goal and a typed goal", () => {
    const notes = buildCoachNotes({ goalChip: "Get stronger", goalText: "315 squat by December" });
    expect(notes).toHaveLength(2);
    expect(notes.every((n) => n.kind === "goal")).toBe(true);
  });
});

describe("the stored wording", () => {
  it("never stores a bare chip label", () => {
    // A note is read months later with no other context. "Legs" or "Shoulder"
    // tells a coach nothing; every option must carry a full sentence.
    for (const o of [...GOAL_OPTIONS, ...EQUIPMENT_OPTIONS, ...LIMIT_OPTIONS]) {
      expect(o.note).not.toBe(o.label);
      expect(o.note.split(" ").length).toBeGreaterThan(3);
    }
  });

  it("keeps every note inside the length the API accepts", () => {
    for (const o of [...GOAL_OPTIONS, ...EQUIPMENT_OPTIONS, ...LIMIT_OPTIONS]) {
      expect(o.note.length).toBeLessThanOrEqual(400);
    }
  });
});

describe("the open question", () => {
  it("stores what somebody typed, exactly, as something the coach can read", () => {
    const notes = buildCoachNotes({
      anythingText: "  Training for a muscle-up. Left shoulder hates overhead.  ",
    });
    // Verbatim apart from the trim: rewriting it would lose the precision that
    // makes it worth having, which is the same reason the old free-text fields
    // were stored as their own notes rather than folded into a chip sentence.
    expect(notes).toEqual([
      { kind: "context", content: "Training for a muscle-up. Left shoulder hates overhead." },
    ]);
  });

  it("writes nothing when it was left empty", () => {
    expect(buildCoachNotes({ anythingText: "   " })).toEqual([]);
    expect(buildCoachNotes({})).toEqual([]);
  });
});
