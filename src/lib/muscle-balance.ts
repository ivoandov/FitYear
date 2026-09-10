/**
 * Which muscle groups are behind, and by how much.
 *
 * PURE, so the rules can be tested without a database and so the same verdict
 * is reachable from a route, a prompt and a home card without three copies of
 * the arithmetic drifting apart.
 *
 * The metric is SETS, not volume. Pounds are not comparable across muscle
 * groups - a leg day out-weighs a month of curls and always will - so ranking
 * by volume would permanently report Biceps as neglected and Legs as fine. Hard
 * sets per week is the unit the training literature actually uses for this
 * question, and it is the one FitYear already records honestly (completed sets
 * only, credited once per coarse group per exercise).
 */

import { COARSE_MUSCLE_GROUPS, type CoarseGroup } from "@/lib/muscle-groups";

/**
 * Groups deliberately excluded from "you are behind" nudges.
 *
 * Cardio and PT are not hypertrophy targets on a schedule: somebody who never
 * logs PT is not neglecting it, they simply do not have an injury. Telling them
 * otherwise every time they open the app is how a coaching feature becomes
 * noise that gets ignored, including on the days it is right.
 */
export const NOT_NUDGED: ReadonlySet<string> = new Set(["Cardio", "PT"]);

export interface GroupActivity {
  group: CoarseGroup;
  /** Whole days since the last completed set crediting this group. Null = never. */
  daysSince: number | null;
  /** Completed sets crediting this group in the last 7 days. */
  sets7: number;
  /** Sets per week averaged over the baseline window, this user's own norm. */
  baselineWeekly: number;
}

export type BalanceStatus = "never" | "behind" | "due" | "on-track";

export interface GroupVerdict extends GroupActivity {
  status: BalanceStatus;
  /** One plain sentence, or null when there is nothing worth saying. */
  reason: string | null;
}

/** Beyond this many days, a trained group is behind whatever its baseline. */
export const STALE_DAYS = 10;
/** Below this share of the user's own weekly norm counts as under-trained. */
export const LOW_SHARE = 0.5;
/** A group has to have been trained at least this often to have a "norm" at all. */
export const MIN_BASELINE_WEEKLY = 1;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Judge one group.
 *
 * Deliberately conservative. "Behind" has to mean something, so it needs either
 * a long absence or a genuine shortfall against THIS user's own habit - never
 * against an invented ideal. Somebody who trains Biceps once a fortnight on
 * purpose is not doing it wrong.
 */
export function judgeGroup(a: GroupActivity): GroupVerdict {
  if (NOT_NUDGED.has(a.group)) {
    return { ...a, status: "on-track", reason: null };
  }
  if (a.daysSince == null) {
    return {
      ...a,
      status: "never",
      reason: `No ${a.group} work logged yet.`,
    };
  }
  if (a.daysSince >= STALE_DAYS) {
    return {
      ...a,
      status: "behind",
      reason: `${a.daysSince} ${plural(a.daysSince, "day", "days")} since you trained ${a.group}.`,
    };
  }
  const hasNorm = a.baselineWeekly >= MIN_BASELINE_WEEKLY;
  if (hasNorm && a.sets7 < a.baselineWeekly * LOW_SHARE && a.daysSince >= 5) {
    return {
      ...a,
      status: "behind",
      reason: `${a.group} is at ${a.sets7} ${plural(a.sets7, "set", "sets")} this week against your usual ${Math.round(a.baselineWeekly)}.`,
    };
  }
  // Trained recently enough, but past the 48-72h window where it is ready again.
  if (a.daysSince >= 4) {
    return {
      ...a,
      status: "due",
      reason: `${a.group} is ready again - last trained ${a.daysSince} days ago.`,
    };
  }
  return { ...a, status: "on-track", reason: null };
}

/** Every group judged, worst first, so a caller can just take the top N. */
export function rankGroups(activity: GroupActivity[]): GroupVerdict[] {
  const order: Record<BalanceStatus, number> = { never: 0, behind: 1, due: 2, "on-track": 3 };
  return activity
    .map(judgeGroup)
    .sort((x, y) => {
      if (order[x.status] !== order[y.status]) return order[x.status] - order[y.status];
      // Within a status, the longest neglected first. "Never" has no days, so
      // it falls back to the group's canonical order for a stable result.
      const dx = x.daysSince ?? Number.POSITIVE_INFINITY;
      const dy = y.daysSince ?? Number.POSITIVE_INFINITY;
      if (dx !== dy) return dy - dx;
      return COARSE_MUSCLE_GROUPS.indexOf(x.group) - COARSE_MUSCLE_GROUPS.indexOf(y.group);
    });
}

/**
 * The one-line headline for the home card, or null when nothing needs saying.
 *
 * Returns null rather than a cheerful nothing-to-report, because a card that
 * appears every single day stops being read on the day it matters.
 */
export function balanceHeadline(verdicts: GroupVerdict[]): string | null {
  const worst = verdicts.filter((v) => v.status === "behind" || v.status === "never");
  if (!worst.length) return null;
  const names = worst.slice(0, 2).map((v) => v.group);
  if (worst.length === 1) return `${names[0]} is behind.`;
  if (worst.length === 2) return `${names[0]} and ${names[1]} are behind.`;
  return `${names[0]}, ${names[1]} and ${worst.length - 2} more are behind.`;
}
