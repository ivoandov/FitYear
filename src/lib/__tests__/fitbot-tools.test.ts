import { describe, it, expect } from "vitest";
import {
  ALL_TOOLS,
  READ_TOOLS,
  WRITE_TOOLS,
  buildProposalRequest,
  isWriteTool,
} from "@/lib/ai/fitbot-tools";

describe("the tool surface", () => {
  it("keeps reads and writes disjoint", () => {
    // A read that ran as a proposal would never execute; a write that ran as a
    // read would execute with no approval. Both failures are silent.
    for (const t of READ_TOOLS) expect(isWriteTool(t.name)).toBe(false);
    for (const t of WRITE_TOOLS) expect(isWriteTool(t.name)).toBe(true);
  });

  it("gives every write tool a request builder", () => {
    // A proposal with no builder renders an Approve button that does nothing.
    for (const t of WRITE_TOOLS) {
      expect(buildProposalRequest(t.name, { routineId: "r", scheduledWorkoutId: "s" })).not.toBeNull();
    }
  });

  it("uses unique tool names", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("requires a summary on every proposal", () => {
    // The user reads the summary before approving. A proposal without one
    // cannot be judged, which would make the approval step theater.
    for (const t of WRITE_TOOLS) {
      const required = (t.input_schema as { required?: string[] }).required ?? [];
      expect(required).toContain("summary");
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
