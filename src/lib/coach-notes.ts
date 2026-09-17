import { scheduledDateKey } from "@/lib/date";

/**
 * The vocabulary and the pure rules for FitBot's memory.
 *
 * Everything here is a pure function over plain data so it can be unit tested
 * without a database or a model call - which matters more than usual, because
 * the two things most likely to rot (what counts as expired, and what counts
 * as the same fact twice) are both invisible at runtime. A memory that
 * silently keeps a stale fact, or accumulates six phrasings of one injury,
 * degrades every future conversation and nothing ever errors.
 */

/**
 * Five kinds, and the distinction between them is load-bearing rather than
 * decorative: the system prompt treats them differently.
 *
 * - `constraint` is a HARD RULE. An injury, a piece of equipment someone does
 *   not have, a day they cannot train. The coach must never propose around it.
 * - `goal` is what they are training for, which is what makes advice pointed
 *   rather than generic.
 * - `preference` is a lean, not a rule. The coach may argue with it.
 * - `context` is a life fact that shapes training: travel, shift work, a bad
 *   sleeper. Often the thing with an expiry.
 * - `agreement` is what the two of them decided together. This is the one that
 *   makes a conversation feel continuous rather than repeated.
 */
export const COACH_NOTE_KINDS = [
  "goal",
  "constraint",
  "preference",
  "context",
  "agreement",
] as const;

export type CoachNoteKind = (typeof COACH_NOTE_KINDS)[number];

export function isCoachNoteKind(value: unknown): value is CoachNoteKind {
  return (
    typeof value === "string" &&
    (COACH_NOTE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * How many active notes one person may hold.
 *
 * Not a cost control - the whole block is a few hundred tokens and it is inside
 * the cached system prefix. It is a QUALITY ceiling. A model handed ninety
 * facts about someone starts averaging them instead of using them, and the
 * specific detail that makes coaching feel personal gets lost in the pile. When
 * this is hit the write tool refuses and tells the model to consolidate or
 * forget something, which is the behavior worth having: a coach with sixty
 * sharp facts about you beats one with two hundred vague ones.
 */
export const MAX_ACTIVE_NOTES = 60;

/** Max characters in one note. A fact, not an essay. */
export const MAX_NOTE_LENGTH = 400;

export type CoachNoteLike = {
  id: string;
  kind: string;
  content: string;
  expiresOn: Date | string | null;
  source?: string;
};

/**
 * Is this note still true today?
 *
 * Compared as DATE KEYS rather than instants, deliberately. `expiresOn` is an
 * authored day ("I am back on the 15th"), not a moment, so resolving it into a
 * zone is the exact mistake that reports a day late from UTC+12 east. Two
 * "YYYY-MM-DD" strings compare correctly with `<` and cannot be shifted by a
 * timezone or a DST boundary.
 *
 * A note expires AFTER its date, not on it: "traveling until the 15th" is still
 * true on the 15th.
 */
export function isActiveOn(note: CoachNoteLike, todayKey: string): boolean {
  if (!note.expiresOn) return true;
  return scheduledDateKey(note.expiresOn) >= todayKey;
}

export function activeNotes<T extends CoachNoteLike>(
  notes: T[],
  todayKey: string,
): T[] {
  return notes.filter((n) => isActiveOn(n, todayKey));
}

/**
 * Normalize a note for comparison: case, surrounding punctuation and internal
 * whitespace all collapse.
 *
 * This is what stops "Left shoulder hurts on overhead press." and "left
 * shoulder hurts on overhead press" becoming two facts. It deliberately does
 * NOT try to be clever about meaning - a fuzzy matcher here would merge
 * "cannot train Mondays" with "cannot train Tuesdays", which is far worse than
 * keeping a near-duplicate. Real semantic consolidation is the model's job via
 * `update_memory`, and the prompt asks for it.
 */
export function normalizeNote(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'.,;:!?-]+|[\s"'.,;:!?-]+$/g, "")
    .trim();
}

/** The existing note this content duplicates, if any. */
export function findDuplicate<T extends CoachNoteLike>(
  notes: T[],
  content: string,
): T | undefined {
  const target = normalizeNote(content);
  if (!target) return undefined;
  return notes.find((n) => normalizeNote(n.content) === target);
}

const KIND_HEADINGS: Record<CoachNoteKind, string> = {
  constraint: "HARD CONSTRAINTS (never propose anything that violates these)",
  goal: "WHAT THEY ARE TRAINING FOR",
  preference: "HOW THEY LIKE TO TRAIN (leanings, not rules - you may push back)",
  context: "LIFE CONTEXT THAT AFFECTS TRAINING",
  agreement: "WHAT YOU AND THEY HAVE ALREADY AGREED",
};

/**
 * Render memory into the block that goes in the system prompt.
 *
 * Grouped by kind and headed by what each group MEANS, because a flat list
 * loses the only distinction that matters at the point of use: the difference
 * between a rule the coach must respect and an opinion it may challenge.
 *
 * Constraints come first. If the model reads nothing else, it reads the injury.
 *
 * Ids are included so the model can revise or drop a specific fact without
 * needing a lookup tool first - one fewer round trip, and round trips are what
 * a conversation feels the cost of.
 *
 * Returns an empty string when there is nothing to say, so a brand-new user
 * gets no empty scaffolding in their prompt.
 */
export function renderCoachMemory(
  notes: CoachNoteLike[],
  todayKey: string,
): string {
  const active = activeNotes(notes, todayKey);
  if (active.length === 0) return "";

  const order: CoachNoteKind[] = [
    "constraint",
    "goal",
    "agreement",
    "preference",
    "context",
  ];

  const sections: string[] = [];
  for (const kind of order) {
    const group = active.filter((n) => n.kind === kind);
    if (group.length === 0) continue;
    const lines = group.map((n) => {
      const expiry = n.expiresOn
        ? ` (until ${scheduledDateKey(n.expiresOn)})`
        : "";
      // Marking who authored a fact is what lets the prompt forbid quietly
      // rewriting something the person said themselves.
      const stated = n.source === "user" ? " [they stated this themselves]" : "";
      return `- [${n.id}] ${n.content}${expiry}${stated}`;
    });
    sections.push(`${KIND_HEADINGS[kind]}\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}
