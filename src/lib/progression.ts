import { lbsToDisplay, round1, type WeightUnit } from "@/lib/units";

/**
 * Progressive overload a user can actually configure.
 *
 * Ivo, 2026-09-18: "I want to progress weight overload by 5lbs or x lbs every x
 * weeks and for the app to bake that in and tell the user + set up the first
 * set weight of each exercise."
 *
 * Most of that machinery already existed and was reachable by nobody. The
 * segmented program builder computes per-week loads deterministically in
 * `lib/program-progression.ts`, writes them onto the routine entry as
 * `targetLoadLbs`, and `lib/track-helpers.ts` prefills set one from it. What
 * was missing is the three things asked for here:
 *
 * 1. A USER-SETTABLE increment. The builder chose it; nothing let a person say
 *    "5 lb". A hand-built routine got no progression at all.
 * 2. EVERY N WEEKS. The existing scheme climbs every non-deload week, full
 *    stop. "Every 2 weeks" could not be expressed.
 * 3. HOLDING WHEN YOU STALL. The existing scheme climbs regardless of whether
 *    the last session was completed, so a program keeps adding weight to a lift
 *    somebody is already failing. Ivo asked for this explicitly.
 *
 * This module is pure so all three are testable without a database, a model or
 * a browser - which matters because the failure mode is silent. A progression
 * that quietly climbs through a stall still renders a plausible number in the
 * weight field; nothing errors and the user just fails another set.
 */

/**
 * One progression rule.
 *
 * `everyWeeks` is 1-indexed and inclusive of week 1: with an increment of 5 and
 * everyWeeks of 2, week 1 is the base, weeks 1-2 sit at base, weeks 3-4 at base
 * plus 5. A user saying "every 2 weeks" means "two weeks at each load", not
 * "skip a week before starting".
 */
export type ProgressionRule = {
  incrementLbs: number;
  everyWeeks: number;
};

export const DEFAULT_PROGRESSION: ProgressionRule = {
  incrementLbs: 5,
  everyWeeks: 1,
};

/** What a rule may be, before validation. Comes from a browser or a model. */
export type MaybeRule = Partial<Record<keyof ProgressionRule, unknown>> | null | undefined;

/**
 * Clamp rather than reject, the same posture `lib/program-schema.ts` takes with
 * model output. A nonsense increment is a slip, not a reason to discard a
 * routine somebody is mid-way through building. 100 lb is far beyond any real
 * weekly jump while leaving sled and rack work room; 52 weeks is a year.
 */
export function normalizeRule(raw: MaybeRule): ProgressionRule | null {
  if (!raw || typeof raw !== "object") return null;
  const inc = Number(raw.incrementLbs);
  const every = Number(raw.everyWeeks);
  if (!Number.isFinite(inc) || inc <= 0) return null;
  return {
    incrementLbs: Math.min(Math.max(inc, 0.5), 100),
    everyWeeks: Number.isFinite(every) ? Math.min(Math.max(Math.round(every), 1), 52) : 1,
  };
}

/**
 * The rule that applies to one exercise.
 *
 * A per-exercise rule wins outright over the routine default rather than
 * merging with it. Ivo wanted both levels and FitBot setting them per exercise
 * "as it's fitting" - and 5 lb on a bench is a different ask from 5 lb on a
 * squat, so a half-inherited rule (this exercise's increment, the routine's
 * frequency) would produce a scheme nobody chose.
 */
export function effectiveRule(
  routineDefault: MaybeRule,
  exerciseOverride: MaybeRule,
): ProgressionRule | null {
  return normalizeRule(exerciseOverride) ?? normalizeRule(routineDefault);
}

/**
 * The planned load for a given week, before any check on how it has been going.
 *
 * Week is 1-indexed. Anything below 1 is treated as week 1 rather than
 * subtracting load: a bad week number should never prescribe less than the
 * starting weight.
 */
export function plannedLoadForWeek(
  baseLoadLbs: number,
  rule: ProgressionRule,
  week: number,
): number {
  const w = Math.max(1, Math.floor(week));
  const steps = Math.floor((w - 1) / rule.everyWeeks);
  return round1(baseLoadLbs + rule.incrementLbs * steps);
}

/**
 * Bake one session's target loads from the routine's rule and the week.
 *
 * Shared by BOTH places that turn a routine into scheduled sessions - starting
 * it, and re-syncing a running one after an edit - so the two cannot disagree.
 * The re-sync used to copy the routine's exercises verbatim, which put every
 * remaining week of a progressing routine back at the STARTING weight the
 * moment somebody changed anything about it.
 *
 * `exercises` must be the ROUTINE's copy, whose `targetLoadLbs` is the starting
 * weight. Never a scheduled row's: that one has already climbed, and feeding it
 * back in climbs twice (the 2026-09-18 gotcha about the two numbers).
 *
 * An exercise with no starting weight is left alone - progression needs
 * somewhere to start, and inventing a first weight would be a guess about
 * somebody's training. So is an ASSISTED lift: its weight is counter-assistance,
 * so adding to it makes the lift easier, and a climb would be a regression
 * presented as progress.
 */
export function progressedExercises(
  exercises: unknown,
  routineRule: MaybeRule,
  week: number,
  isAssisted: (ex: Record<string, unknown>) => boolean = () => false,
): unknown[] {
  if (!Array.isArray(exercises)) return [];
  return exercises.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const ex = raw as Record<string, unknown>;
    const base = Number(ex.targetLoadLbs);
    if (!Number.isFinite(base) || base <= 0) return ex;
    if (isAssisted(ex)) return ex;
    const rule = effectiveRule(routineRule, ex.progression as MaybeRule);
    if (!rule) return ex;
    return { ...ex, targetLoadLbs: plannedLoadForWeek(base, rule, week) };
  });
}

/** What happened the last time this exercise was performed at its target. */
export type LastAttempt = {
  /** Heaviest completed working load, in lbs. */
  topWeightLbs: number;
  /** Reps achieved on that set. */
  reps: number;
  /** Reps the plan asked for. Null when the plan did not say. */
  targetReps: number | null;
};

export type ResolvedTarget = {
  loadLbs: number;
  /** True when the climb was withheld because the last attempt fell short. */
  held: boolean;
  /** One short sentence for the user. Null when there is nothing to explain. */
  reason: string | null;
};

/**
 * The load to actually put in front of somebody this week.
 *
 * The plan climbs; this decides whether to honour the climb. A program that
 * keeps adding weight to a lift you are already missing is worse than one that
 * holds, and it is the thing that makes linear progression fall apart in week
 * six rather than week two.
 *
 * HOLDS, never reduces. Deloading automatically would be a much bigger claim
 * about somebody's training than this has evidence for - one short session is
 * not a stall - and a surprise drop in prescribed weight reads as a bug. So the
 * worst case is repeating a week, which is what a lifter would do anyway.
 *
 * With no history the plan is honoured: a first session has nothing to fall
 * short of.
 */
export function resolveTarget(
  baseLoadLbs: number,
  rule: ProgressionRule,
  week: number,
  last?: LastAttempt | null,
): ResolvedTarget {
  const planned = plannedLoadForWeek(baseLoadLbs, rule, week);
  if (!last || last.targetReps == null) {
    return { loadLbs: planned, held: false, reason: null };
  }

  // Only a shortfall AT OR ABOVE the load being prescribed is evidence. Missing
  // reps on a lighter warm-up or a deliberately lighter day says nothing about
  // whether the next step up is reachable.
  const missedAtLoad = last.reps < last.targetReps && last.topWeightLbs >= planned - rule.incrementLbs;
  if (!missedAtLoad) {
    return { loadLbs: planned, held: false, reason: null };
  }

  const held = round1(Math.max(baseLoadLbs, last.topWeightLbs));
  return {
    loadLbs: held,
    held: true,
    reason: `Holding at ${held} lb. You got ${last.reps} of ${last.targetReps} reps last time, so this repeats before adding weight.`,
  };
}

/**
 * A plain-language summary of a rule, for the routine card.
 *
 * Ivo asked for the app to "tell the user" rather than silently move numbers,
 * which is the half of progressive overload that builds trust in the plan.
 *
 * In the viewer's unit: the rule is stored in pounds like every weight in the
 * app, and a kg user was being told "+5 lb every week" about their own plan
 * until 2026-09-18.
 */
export function describeRule(rule: ProgressionRule | null, unit: WeightUnit = "lbs"): string | null {
  if (!rule) return null;
  const amount = lbsToDisplay(rule.incrementLbs, unit) ?? rule.incrementLbs;
  const inc = amount % 1 === 0 ? String(amount) : amount.toFixed(1);
  const label = unit === "kg" ? "kg" : "lb";
  return rule.everyWeeks === 1
    ? `+${inc} ${label} every week`
    : `+${inc} ${label} every ${rule.everyWeeks} weeks`;
}
