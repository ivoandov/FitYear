import type { CoachNoteKind } from "@/lib/coach-notes";

/**
 * The onboarding vocabulary and the pure rules behind it.
 *
 * Everything the screen ASKS and everything it WRITES lives here rather than in
 * JSX, for one reason: the answers become `coach_notes`, and a note is read by
 * the coach months later with no other context. The exact wording of what gets
 * stored is therefore product surface, not presentation, and it deserves to be
 * testable.
 *
 * Ivo, 2026-09-17, framing the product: "FitYear is an app where you can
 * mundanely track your workouts if you want or where you can have a
 * personalized fitness coach guide you through the journey if you want, and
 * anything in between." That is why the first question is which of those you
 * want, and why the rest of the flow depends on the answer.
 */

/** Which end of the spectrum this person is on. Asked first, because it decides what else is worth asking. */
export type Door = "track" | "coach" | "import";

export type StepKey = "unit" | "days" | "goal" | "equipment" | "limits" | "anything";

/**
 * What each door asks, in order.
 *
 * The tracker path asks ONE thing. Somebody who said "just let me log my
 * workouts" has told us not to interview them, and the weight unit is the only
 * question whose wrong answer is visible on every screen afterwards.
 */
export const FLOW: Record<Door, StepKey[]> = {
  track: ["unit"],
  // The coached path deliberately does NOT ask about goals, equipment or
  // limitations any more. Ivo ran this on 2026-09-22 and hit the duplication
  // head on: "the process seems to have two kinds of onboarding questions,
  // styled in two different ways. the first 4 asked about goals (strength,
  // muscle, etc), then the second set also asked about the same." The program
  // builder asks all three, in its own better-suited UI, and now writes its
  // answers into memory itself - so asking here was asking twice and keeping
  // the worse answer.
  //
  // What stays is what the builder does NOT ask: the unit, how many days a week
  // they can train, and one open question in their own words. Ivo on that
  // field: "There was an optional 'Add notes' here on a couple of them but it
  // didn't feel like that was the right invocation or place to invite the user
  // to truly share what's on their mind."
  coach: ["unit", "days", "anything"],
  import: ["unit"],
};

/**
 * Where each door lands.
 *
 * `track` goes to Home rather than `/track`, which is a correction to the
 * original spec: with no active workout the tracker renders a "No Active
 * Workout - Go to Workouts" empty state, so landing there would be a dead end
 * that bounces the user straight back. Home is where the start-workout button
 * actually is.
 */
export const DESTINATION: Record<Door, string> = {
  track: "/",
  coach: "/fit-bot",
  import: "/import",
};

export type ChipOption = {
  /** What the user taps. */
  label: string;
  /**
   * What FitBot stores and reads back. A full sentence, not the label: "Legs"
   * tells a coach reading its memory in March precisely nothing.
   */
  note: string;
};

export const GOAL_OPTIONS: ChipOption[] = [
  { label: "Build muscle", note: "Training to build muscle" },
  { label: "Get stronger", note: "Training to get stronger on the main lifts" },
  { label: "Lose fat", note: "Training to lose fat while keeping strength" },
  { label: "Stay consistent", note: "Training to stay consistent rather than hit a specific number" },
  { label: "Get back into it", note: "Returning to training after time away" },
];

export const EQUIPMENT_OPTIONS: ChipOption[] = [
  { label: "Full gym", note: "Trains at a full gym with barbells, machines and dumbbells available" },
  { label: "Home setup", note: "Trains at home with limited equipment, such as dumbbells or bands" },
  { label: "Bodyweight only", note: "Trains with bodyweight only and no equipment" },
];

/**
 * Limitations, and the wording is deliberately cautious.
 *
 * A chip says there is something to work around; it does NOT put a diagnosis or
 * a restriction into the person's mouth. The free-text field is where the real
 * detail goes, and a coach that needs more should ask rather than assume.
 */
export const LIMIT_OPTIONS: ChipOption[] = [
  { label: "Shoulder", note: "Has a shoulder issue to train around" },
  { label: "Knee", note: "Has a knee issue to train around" },
  { label: "Lower back", note: "Has a lower back issue to train around" },
  { label: "Elbow or wrist", note: "Has an elbow or wrist issue to train around" },
  { label: "Hip", note: "Has a hip issue to train around" },
];

/**
 * A month's workout target, derived from days per week rather than asked.
 *
 * Asking the same intention twice in different units is the kind of form that
 * makes people quit, and the app already defaults everybody to 16 regardless of
 * what they just said. 4.35 is the mean number of weeks in a month.
 *
 * Clamped to the range `PATCH /api/user-settings` accepts, so a value from here
 * can never be the thing that 400s the request that completes onboarding.
 */
export function monthlyGoalFromDaysPerWeek(daysPerWeek: number): number {
  const raw = Math.round(daysPerWeek * 4.35);
  return Math.min(31, Math.max(1, raw));
}

export type OnboardingAnswers = {
  goalChip?: string | null;
  goalText?: string | null;
  equipmentChip?: string | null;
  limitChips?: string[];
  limitText?: string | null;
  /** The open question, in their own words. Stored exactly as typed. */
  anythingText?: string | null;
};

export type DraftNote = { kind: CoachNoteKind; content: string };

/**
 * Turn the answers into the notes FitBot will read.
 *
 * Free text is stored VERBATIM and as its own note rather than merged into the
 * chip's sentence. Somebody who types "left shoulder, only overhead" has said
 * something more precise than any chip, and rewriting it would lose exactly the
 * detail that makes it worth having.
 *
 * Equipment and limitations are `constraint` rather than `preference`, which is
 * the kind the system prompt renders first and describes as a rule the coach
 * must never propose around. That mapping is the whole point of collecting
 * them.
 */
export function buildCoachNotes(answers: OnboardingAnswers): DraftNote[] {
  const notes: DraftNote[] = [];

  const goalChip = GOAL_OPTIONS.find((o) => o.label === answers.goalChip);
  if (goalChip) notes.push({ kind: "goal", content: goalChip.note });

  const goalText = answers.goalText?.trim();
  if (goalText) notes.push({ kind: "goal", content: goalText });

  const equipment = EQUIPMENT_OPTIONS.find((o) => o.label === answers.equipmentChip);
  if (equipment) notes.push({ kind: "constraint", content: equipment.note });

  for (const label of answers.limitChips ?? []) {
    const limit = LIMIT_OPTIONS.find((o) => o.label === label);
    if (limit) notes.push({ kind: "constraint", content: limit.note });
  }

  const limitText = answers.limitText?.trim();
  if (limitText) notes.push({ kind: "constraint", content: limitText });

  // The open question. `context` rather than `constraint` or `goal`, because
  // nobody knows what somebody will write there and inventing a kind for it
  // would be putting words in their mouth; the coach reads every kind, and a
  // wrong kind on a true sentence is worse than a neutral one.
  const anythingText = answers.anythingText?.trim();
  if (anythingText) notes.push({ kind: "context", content: anythingText });

  return notes;
}
