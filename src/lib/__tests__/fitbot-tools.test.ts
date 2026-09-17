import { describe, it, expect } from "vitest";
import {
  ALL_TOOLS,
  MEMORY_TOOLS,
  PROPOSAL_TOOLS,
  READ_TOOLS,
  buildProposalRequest,
  isMemoryTool,
  isProposalTool,
} from "@/lib/ai/fitbot-tools";

describe("the tool surface", () => {
  it("puts every tool in exactly one of the three categories", () => {
    // The categories decide what HAPPENS when the model calls something, and
    // every way of getting it wrong is silent. A proposal misread as a read
    // would execute a change with no approval. A read misread as a proposal
    // would never run and would sit waiting for the user to approve a lookup.
    // A memory write misread as a proposal would make the coach ask permission
    // to remember things, which is the whole restriction this replaced.
    for (const t of READ_TOOLS) {
      expect(isProposalTool(t.name)).toBe(false);
      expect(isMemoryTool(t.name)).toBe(false);
    }
    for (const t of MEMORY_TOOLS) {
      expect(isMemoryTool(t.name)).toBe(true);
      expect(isProposalTool(t.name)).toBe(false);
    }
    for (const t of PROPOSAL_TOOLS) {
      expect(isProposalTool(t.name)).toBe(true);
      expect(isMemoryTool(t.name)).toBe(false);
    }
  });

  it("offers all three categories to the model", () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name));
    // A tool list that quietly dropped a category would leave the feature
    // built, wired and unreachable - the class of bug routine-usage was.
    for (const t of [...READ_TOOLS, ...MEMORY_TOOLS, ...PROPOSAL_TOOLS]) {
      expect(names.has(t.name)).toBe(true);
    }
  });

  it("gives every proposal tool a request builder", () => {
    // A proposal with no builder renders an Approve button that does nothing.
    for (const t of PROPOSAL_TOOLS) {
      expect(buildProposalRequest(t.name, { routineId: "r", scheduledWorkoutId: "s" })).not.toBeNull();
    }
  });

  it("gives no memory tool a request builder", () => {
    // Memory executes server-side. A builder here would mean it had also been
    // wired as a proposal, which is the double-write this split exists to stop.
    for (const t of MEMORY_TOOLS) {
      expect(buildProposalRequest(t.name, {})).toBeNull();
    }
  });

  it("uses unique tool names", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("requires a summary on every proposal", () => {
    // The user reads the summary before approving. A proposal without one
    // cannot be judged, which would make the approval step theater.
    for (const t of PROPOSAL_TOOLS) {
      const required = (t.input_schema as { required?: string[] }).required ?? [];
      expect(required).toContain("summary");
    }
  });

  it("requires no summary on a memory tool", () => {
    // Nothing is approved, so a summary would be a field written for a dialog
    // that never opens - tokens spent on every note for nobody to read.
    for (const t of MEMORY_TOOLS) {
      const required = (t.input_schema as { required?: string[] }).required ?? [];
      expect(required).not.toContain("summary");
    }
  });
});

describe("buildProposalRequest", () => {
  it("translates the model's days into a routine's entries", () => {
    // The model speaks in `days`; a routine is written as `entries`. Copying
    // the field across verbatim would put the model's vocabulary in the DB.
    const req = buildProposalRequest("propose_routine_change", {
      routineId: "abc",
      summary: "Drop to 4 days",
      days: [
        { dayIndex: 1, workoutName: "Push", exercises: [{ name: "Bench", sets: 4, reps: "6-8" }] },
        { dayIndex: 3, workoutName: "Pull", exercises: [] },
      ],
    });
    expect(req).toEqual({
      method: "PUT",
      path: "/api/routines/abc",
      body: {
        entries: [
          {
            dayIndex: 1,
            workoutName: "Push",
            workoutTemplateId: null,
            exercises: [{ name: "Bench", sets: 4, reps: "6-8" }],
          },
          { dayIndex: 3, workoutName: "Pull", workoutTemplateId: null, exercises: [] },
        ],
      },
    });
  });

  it("keeps a rep range as the string it is", () => {
    const req = buildProposalRequest("propose_routine_change", {
      routineId: "abc",
      days: [{ dayIndex: 1, workoutName: "Push", exercises: [{ name: "Bench", sets: 4, reps: "6-8" }] }],
    });
    const entries = (req!.body as { entries: { exercises: { reps: unknown }[] }[] }).entries;
    expect(entries[0].exercises[0].reps).toBe("6-8");
  });

  it("defaults a resync to KEEPING a dropped day's sessions", () => {
    // Deleting somebody's upcoming workouts must never be what happens when
    // the model simply did not mention the flag.
    const req = buildProposalRequest("propose_program_resync", {
      routineId: "abc",
      summary: "Push the change to my calendar",
    });
    expect(req!.body).toEqual({ removeOrphaned: false });
  });

  it("omits fields the model did not name on a scheduled-workout edit", () => {
    // A PUT carrying undefined would blank a value the user never asked to
    // change - the name, or the whole exercise list.
    const req = buildProposalRequest("propose_update_scheduled_workout", {
      scheduledWorkoutId: "sw1",
      summary: "Move it to Friday",
      date: "2026-09-18",
    });
    expect(req).toEqual({
      method: "PUT",
      path: "/api/scheduled-workouts/sw1",
      body: { date: "2026-09-18" },
    });
  });

  it("returns null for a tool it does not know", () => {
    // A model that invents a tool name must not break the page.
    expect(buildProposalRequest("propose_something_invented", {})).toBeNull();
  });
});
