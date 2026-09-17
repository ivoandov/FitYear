import { describe, it, expect } from "vitest";
import {
  COACH_NOTE_KINDS,
  activeNotes,
  findDuplicate,
  isActiveOn,
  isCoachNoteKind,
  normalizeNote,
  renderCoachMemory,
  type CoachNoteLike,
} from "@/lib/coach-notes";

function note(over: Partial<CoachNoteLike> = {}): CoachNoteLike {
  return {
    id: "n1",
    kind: "goal",
    content: "Squat 315 by December",
    expiresOn: null,
    source: "fitbot",
    ...over,
  };
}

describe("expiry", () => {
  it("keeps a note with no expiry forever", () => {
    expect(isActiveOn(note(), "2030-01-01")).toBe(true);
  });

  it("keeps a note ON its expiry day", () => {
    // "Traveling until the 15th" is still true on the 15th. Expiring at the
    // start of that day would drop the fact exactly while it still applies.
    expect(isActiveOn(note({ expiresOn: "2026-09-15" }), "2026-09-15")).toBe(true);
  });

  it("drops a note the day after", () => {
    expect(isActiveOn(note({ expiresOn: "2026-09-15" }), "2026-09-16")).toBe(false);
  });

  it("compares date keys, not instants", () => {
    // The trap this guards: resolving an authored day in a viewer's timezone
    // reports it a day early or late from the far side of the world. A note
    // that expires on the 15th expires on the 15th in Auckland too.
    const n = note({ expiresOn: new Date("2026-09-15T12:00:00Z") });
    expect(isActiveOn(n, "2026-09-15")).toBe(true);
    expect(isActiveOn(n, "2026-09-16")).toBe(false);
  });

  it("filters a list without touching the permanent ones", () => {
    const list = [
      note({ id: "a", expiresOn: null }),
      note({ id: "b", expiresOn: "2026-09-01" }),
      note({ id: "c", expiresOn: "2026-12-31" }),
    ];
    expect(activeNotes(list, "2026-09-17").map((n) => n.id)).toEqual(["a", "c"]);
  });
});

describe("duplicate detection", () => {
  it("ignores case, surrounding punctuation and internal spacing", () => {
    expect(normalizeNote('  "Left shoulder hurts."  ')).toBe("left shoulder hurts");
    expect(normalizeNote("Left  shoulder\nhurts")).toBe("left shoulder hurts");
  });

  it("finds a restated fact", () => {
    const existing = [note({ id: "x", content: "Left shoulder hurts on overhead press" })];
    expect(findDuplicate(existing, "left shoulder hurts on overhead press.")?.id).toBe("x");
  });

  it("does NOT merge two facts that merely look similar", () => {
    // Deliberately dumb. A fuzzy matcher here would fold "cannot train
    // Mondays" into "cannot train Tuesdays", and a wrong fact about someone's
    // week is far worse than holding a near-duplicate.
    const existing = [note({ content: "Cannot train Mondays" })];
    expect(findDuplicate(existing, "Cannot train Tuesdays")).toBeUndefined();
  });

  it("treats empty content as matching nothing", () => {
    expect(findDuplicate([note()], "   ")).toBeUndefined();
  });
});

describe("the kind vocabulary", () => {
  it("accepts every kind it publishes and nothing else", () => {
    for (const k of COACH_NOTE_KINDS) expect(isCoachNoteKind(k)).toBe(true);
    expect(isCoachNoteKind("injury")).toBe(false);
    expect(isCoachNoteKind(null)).toBe(false);
  });
});

describe("rendering memory into the prompt", () => {
  it("says nothing at all when there is nothing to say", () => {
    // A brand-new user should not get an empty scaffold in their prompt.
    expect(renderCoachMemory([], "2026-09-17")).toBe("");
  });

  it("puts hard constraints first", () => {
    // If the model reads one line of memory, it reads the injury.
    const out = renderCoachMemory(
      [
        note({ id: "g", kind: "goal", content: "Squat 315" }),
        note({ id: "c", kind: "constraint", content: "No overhead pressing" }),
      ],
      "2026-09-17",
    );
    expect(out.indexOf("HARD CONSTRAINTS")).toBeLessThan(out.indexOf("TRAINING FOR"));
  });

  it("leaves expired notes out", () => {
    const out = renderCoachMemory(
      [note({ content: "Traveling", kind: "context", expiresOn: "2026-09-01" })],
      "2026-09-17",
    );
    expect(out).toBe("");
  });

  it("includes ids so a fact can be revised without a lookup first", () => {
    expect(renderCoachMemory([note({ id: "abc123" })], "2026-09-17")).toContain("[abc123]");
  });

  it("marks what the person said themselves", () => {
    // The prompt forbids quietly rewriting these, so the marker has to survive
    // into the text the model actually reads.
    const out = renderCoachMemory([note({ source: "user" })], "2026-09-17");
    expect(out).toContain("they stated this themselves");
  });

  it("shows an expiry date so the coach can reason about it", () => {
    const out = renderCoachMemory(
      [note({ kind: "context", content: "In Spain", expiresOn: "2026-10-02" })],
      "2026-09-17",
    );
    expect(out).toContain("(until 2026-10-02)");
  });

  it("groups by kind rather than listing everything flat", () => {
    const out = renderCoachMemory(
      [
        note({ id: "1", kind: "preference", content: "Hates burpees" }),
        note({ id: "2", kind: "preference", content: "Trains mornings" }),
      ],
      "2026-09-17",
    );
    // One heading, both facts under it.
    expect(out.match(/HOW THEY LIKE TO TRAIN/g)?.length).toBe(1);
    expect(out).toContain("Hates burpees");
    expect(out).toContain("Trains mornings");
  });
});
