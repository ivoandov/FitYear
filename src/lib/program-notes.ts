import type { CoachNoteKind } from "@/lib/coach-notes";

/**
 * What the program builder learns about somebody, as things FitBot remembers.
 *
 * Onboarding used to ask for a goal, equipment and limitations, and then the
 * builder asked the same three in its own words and its own visual style. Ivo,
 * running it on 2026-09-22: "the first 4 asked about goals (strength, muscle,
 * etc), then the second set also asked about the same." The duplication is gone
 * from onboarding, which means the builder's answers are now the ONLY place
 * those facts are stated - so they have to reach memory, or building a program
 * would teach the coach nothing.
 *
 * Same discipline as the onboarding notes: a stored note is read back months
 * later with no other context, so "Strength" is worthless and the sentence is
 * what gets written. Free text is stored VERBATIM and as its own note, because
 * somebody who types "shoulder only hurts on overhead pressing" has said
 * something no chip can.
 */

export type DraftNote = { kind: CoachNoteKind; content: string };

/** The builder's chips, as sentences. Anything unlisted falls back to its label. */
const FOCUS_NOTES: Record<string, string> = {
  Strength: "Training for strength on the main lifts",
  Hypertrophy: "Training for muscle size",
  Calisthenics: "Training for calisthenics and bodyweight skills",
  Flexibility: "Training for flexibility and mobility",
  Mixed: "Training for a mix of strength and conditioning",
  Athletic: "Training for athletic performance",
};

const EQUIPMENT_NOTES: Record<string, string> = {
  "Full Gym": "Trains at a full gym with barbells, machines and dumbbells available",
  "Home + Weights": "Trains at home with weights, such as dumbbells or a barbell",
  Bodyweight: "Trains with bodyweight only",
  "Resistance Bands": "Trains with resistance bands",
};

const EXTRA_NOTES: Record<string, string> = {
  "Lose body fat": "Wants to lose body fat alongside training",
  "Improve cardio": "Wants to improve cardio",
  "Build muscle": "Training to build muscle",
  "Get stronger": "Training to get stronger on the main lifts",
};

export type ProgramAnswers = {
  focus?: string[];
  equipment?: string[];
  experience?: string | null;
  extras?: string[];
  /** Free text, all stored exactly as typed. */
  injuryNotes?: string | null;
  imbalanceNotes?: string | null;
  structureNotes?: string | null;
};

export function programAnswerNotes(answers: ProgramAnswers): DraftNote[] {
  const notes: DraftNote[] = [];

  for (const label of answers.focus ?? []) {
    notes.push({ kind: "goal", content: FOCUS_NOTES[label] ?? `Training focus: ${label}` });
  }

  for (const label of answers.equipment ?? []) {
    // Equipment is a `constraint`: the prompt renders those first and calls
    // them rules the coach may not propose around, which is exactly right for
    // "there is no barbell here".
    notes.push({
      kind: "constraint",
      content: EQUIPMENT_NOTES[label] ?? `Trains with: ${label}`,
    });
  }

  const experience = answers.experience?.trim();
  if (experience) {
    notes.push({ kind: "context", content: `Describes their training experience as ${experience.toLowerCase()}` });
  }

  for (const label of answers.extras ?? []) {
    // "Train around injury" and "Fix muscle imbalances" are not facts, they are
    // requests to be ASKED - their detail arrives in the free-text fields
    // below, so the chip itself is not worth remembering.
    const note = EXTRA_NOTES[label];
    if (note) notes.push({ kind: "goal", content: note });
  }

  const injury = answers.injuryNotes?.trim();
  if (injury) notes.push({ kind: "constraint", content: injury });

  const imbalance = answers.imbalanceNotes?.trim();
  if (imbalance) notes.push({ kind: "context", content: imbalance });

  const structure = answers.structureNotes?.trim();
  if (structure) notes.push({ kind: "preference", content: structure });

  return notes;
}
