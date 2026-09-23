import { describe, it, expect } from "vitest";
import { programAnswerNotes } from "@/lib/program-notes";

describe("programAnswerNotes", () => {
  it("stores sentences, never the chip label", () => {
    // A note is read back months later with no other context, so "Strength"
    // tells the coach nothing. Same rule the onboarding notes follow.
    const notes = programAnswerNotes({ focus: ["Strength"], equipment: ["Full Gym"] });
    expect(notes.map((n) => n.content)).toEqual([
      "Training for strength on the main lifts",
      "Trains at a full gym with barbells, machines and dumbbells available",
    ]);
    for (const note of notes) {
      expect(note.content).not.toBe("Strength");
      expect(note.content).not.toBe("Full Gym");
    }
  });

  it("makes equipment a constraint and focus a goal", () => {
    // Constraints render first in the prompt and are described as rules the
    // coach may not propose around, which is what "there is no barbell here"
    // is. A focus is what they are training FOR.
    const notes = programAnswerNotes({ focus: ["Hypertrophy"], equipment: ["Bodyweight"] });
    expect(notes.find((n) => n.content.includes("muscle size"))?.kind).toBe("goal");
    expect(notes.find((n) => n.content.includes("bodyweight"))?.kind).toBe("constraint");
  });

  it("keeps free text exactly as it was typed", () => {
    const notes = programAnswerNotes({
      injuryNotes: "left shoulder, only overhead pressing",
      imbalanceNotes: "right side weaker on single-leg work",
      structureNotes: "45 minutes at lunch, longer on Saturdays",
    });
    expect(notes).toEqual([
      { kind: "constraint", content: "left shoulder, only overhead pressing" },
      { kind: "context", content: "right side weaker on single-leg work" },
      { kind: "preference", content: "45 minutes at lunch, longer on Saturdays" },
    ]);
  });

  it("does not remember a chip that was only a request to be asked", () => {
    // "Train around injury" is not a fact about anybody; its detail arrives in
    // the injury field. Storing the chip would fill memory with nothing.
    const notes = programAnswerNotes({ extras: ["Train around injury", "Fix muscle imbalances"] });
    expect(notes).toEqual([]);
  });

  it("remembers the extras that ARE goals", () => {
    const notes = programAnswerNotes({ extras: ["Lose body fat"] });
    expect(notes).toEqual([{ kind: "goal", content: "Wants to lose body fat alongside training" }]);
  });

  it("falls back to the label for a chip it does not know", () => {
    // The wizard's vocabulary can grow without this module; an unmapped chip
    // should still reach memory as something readable rather than vanish.
    const notes = programAnswerNotes({ focus: ["Powerlifting"] });
    expect(notes).toEqual([{ kind: "goal", content: "Training focus: Powerlifting" }]);
  });

  it("writes nothing when nothing was answered", () => {
    expect(programAnswerNotes({})).toEqual([]);
    expect(programAnswerNotes({ focus: [], equipment: [], injuryNotes: "   " })).toEqual([]);
  });
});
