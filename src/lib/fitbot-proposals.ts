/**
 * How a FitBot proposal card reads, and when one is out of date.
 *
 * Pure, so the chat page stays a renderer. Written 2026-10-03 after Ivo's first
 * real run of building and starting a program through the chat: by the end of
 * one conversation there were five live Approve buttons on screen (three
 * versions of the routine and two start dates), every card was headed the same
 * "Proposed change", and the start card read "startDate: 2026-10-05". He
 * approved the newest routine change, saw nothing happen on his calendar, and
 * read it as a button that did nothing: a routine change was never going to
 * start anything, and no card said so.
 */
import { addDaysToDateKey } from "@/lib/date";
import { resolveDurationDays } from "@/lib/ai/fitbot-tools";

export type ProposalStatus = "pending" | "approved" | "rejected" | "failed" | "superseded";

export type ProposalLike = {
  tool: string;
  input: Record<string, unknown>;
  status: ProposalStatus;
};

/** The card's heading: what approving it DOES, in the user's words. */
export function proposalTitle(tool: string): string {
  switch (tool) {
    case "propose_routine_change":
      return "Update the routine";
    case "propose_start_routine":
      return "Start the program";
    case "propose_end_program":
      return "End the program";
    case "propose_program_resync":
      return "Update your scheduled sessions";
    case "propose_schedule_workout":
      return "Schedule a workout";
    case "propose_update_scheduled_workout":
      return "Change a scheduled workout";
    case "propose_delete_scheduled_workout":
      return "Remove a scheduled workout";
    case "propose_create_exercise":
      return "Add an exercise";
    case "propose_log_measurement":
      return "Log a measurement";
    case "propose_update_settings":
      return "Change a setting";
    default:
      return "Proposed change";
  }
}

/**
 * The one sentence that stops a card being misread, where there is one.
 *
 * The routine change is the one that matters: approving it saves the routine's
 * days and touches nothing on the calendar, whether or not a program is running
 * (a running one needs a resync, which is its own card).
 */
export function proposalConsequence(tool: string): string | null {
  switch (tool) {
    case "propose_routine_change":
      return "Saves the routine. It does not start a program or change your calendar by itself.";
    case "propose_end_program":
      return "Sessions you have done stay in your history. Upcoming ones leave the calendar.";
    case "propose_program_resync":
      return "Rewrites the upcoming sessions of your running program to match the routine.";
    default:
      return null;
  }
}

/**
 * Which earlier card a new one replaces, or null when two can both stand.
 *
 * A newer version of the SAME change makes the older one wrong to approve:
 * approving Ivo's first routine card after his third would have quietly undone
 * the renames and the cable swaps. Only one program can run, so any newer start
 * replaces any older start. Scheduling two different workouts, or creating two
 * exercises, are separate requests and never replace each other.
 */
export function supersedeKey(tool: string, input: Record<string, unknown>): string | null {
  switch (tool) {
    case "propose_routine_change":
    case "propose_program_resync":
      return `${tool}:${String(input.routineId ?? "")}`;
    case "propose_start_routine":
    case "propose_end_program":
    case "propose_update_settings":
      return tool;
    case "propose_update_scheduled_workout":
    case "propose_delete_scheduled_workout":
      return `scheduled:${String(input.scheduledWorkoutId ?? "")}`;
    default:
      return null;
  }
}

/** Mark every still-pending card that `incoming` replaces. Never touches a decided one. */
export function supersedePending<T extends ProposalLike>(existing: T[], incoming: ProposalLike): T[] {
  const key = supersedeKey(incoming.tool, incoming.input);
  if (!key) return existing;
  return existing.map((p) =>
    p.status === "pending" && supersedeKey(p.tool, p.input) === key ? { ...p, status: "superseded" } : p,
  );
}

/** "Fri, Oct 2" for a YYYY-MM-DD day. The day as written: no zone moves it. */
export function formatDayKey(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${key}T12:00:00Z`));
}

/** "12 weeks", "10 days", "3 months": a length the way a person would say it. */
export function durationWords(days: number): string {
  if (days % 30 === 0 && days >= 60 && days % 7 !== 0) return `${days / 30} months`;
  if (days % 7 === 0) return days === 7 ? "1 week" : `${days / 7} weeks`;
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * "Starts Fri, Oct 2 and runs 12 weeks, through Thu, Dec 24."
 *
 * Null without a usable start day. Without a length the routine's own default
 * applies, which the card cannot know, so it says only when it starts.
 */
export function describeStart(input: Record<string, unknown>): string | null {
  const start = typeof input.startDate === "string" ? input.startDate : null;
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const days = resolveDurationDays(input);
  if (days === undefined) return `Starts ${formatDayKey(start)}, for the routine's usual length.`;
  const last = addDaysToDateKey(start, days - 1);
  return `Starts ${formatDayKey(start)} and runs ${durationWords(days)}, through ${formatDayKey(last)}.`;
}

/**
 * Is a change to this routine still waiting above a start card?
 *
 * A start schedules the routine exactly as SAVED. Ivo's first start card was
 * offered while the rewritten routine was still unapproved, so approving it
 * would have put the OLD routine on his calendar.
 */
export function hasPendingRoutineChange(
  proposals: ProposalLike[],
  routineId: unknown,
): boolean {
  return proposals.some(
    (p) =>
      p.status === "pending" &&
      p.tool === "propose_routine_change" &&
      String(p.input.routineId ?? "") === String(routineId ?? ""),
  );
}

/** A field name as a label: "measuredOn" to "Measured on". */
export function fieldLabel(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
