/**
 * What the plan said versus what actually happened.
 *
 * The routine holds the prescription; `completed_workouts` (joined by
 * `routineDayIndex`) holds what the user really did. Comparing them is what
 * lets FitBot say "you have added curls to Day 2 three times running" instead
 * of guessing from a description.
 *
 * Everything here is PURE. The assembly that fetches rows lives in
 * `lib/api/routine-adherence.ts`; keeping the rules separate is what makes
 * them testable without a database.
 *
 * Three rules this module exists to enforce:
 *
 * 1. **Only COMPLETED sets count as performed.** The tracker prefills rows from
 *    history, so an exercise the user opened and abandoned still has rows
 *    carrying weight and reps. Counting those would report work nobody did.
 * 2. **Match exercises by canonical name, not string equality.** "Cable Bicep
 *    Curls" and "Bicep Curls - Cable" are the same movement, and reading them
 *    as one drop plus one add would invent a change the user never made.
 * 3. **A prescribed rep target is a STRING** ("6-8", "AMRAP", "30s"). It is
 *    reported verbatim and never parsed into a number.
 */
import { normalizeExerciseName, nameMatchScore, DEFAULT_MATCH_THRESHOLD } from "@/lib/exercise-match";

export type PlannedExercise = {
  name: string;
  /** Prescribed set count, when the plan gives one. */
  sets?: number | null;
  /** Prescribed reps, VERBATIM: "6-8", "AMRAP", "30s". Never parsed. */
  reps?: string | null;
  targetLoadLbs?: number | null;
};

export type PerformedExercise = {
  name: string;
  /** COMPLETED sets only. */
  sets: number;
  /** Heaviest completed set, in lbs. Null for an exercise with no load. */
  topWeightLbs: number | null;
};

export type PerformedSession = {
  completedWorkoutId: string;
  dayIndex: number;
  completedAt: Date;
  exercises: PerformedExercise[];
};

export type SessionDiff = {
  completedWorkoutId: string;
  dayIndex: number;
  completedAt: Date;
  /** Performed but not prescribed. */
  added: PerformedExercise[];
  /** Prescribed but never completed a set. */
  dropped: PlannedExercise[];
  /** Performed and prescribed, with the set count differing. */
  setChanges: {
    name: string;
    plannedSets: number;
    performedSets: number;
  }[];
};

/** A pattern across every session of ONE routine day. */
export type DayPattern = {
  dayIndex: number;
  workoutName: string | null;
  sessionCount: number;
  /** Exercises added in at least one session, with how often. */
  added: { name: string; timesAdded: number }[];
  /** Prescribed exercises skipped in at least one session. */
  dropped: { name: string; timesDropped: number }[];
  /** Set counts that consistently differ from the prescription. */
  setChanges: { name: string; plannedSets: number; typicalSets: number; sessions: number }[];
};

export type AdherenceSummary = {
  routineName: string;
  sessionsCompleted: number;
  daysWithData: number;
  patterns: DayPattern[];
  /**
   * True when nothing has been completed against this routine yet, so callers
   * can say "no data" rather than "you have changed nothing", which are very
   * different statements.
   */
  noData: boolean;
};

/**
 * Pair two exercise names. Exact canonical equality first, then the shared
 * fuzzy matcher at its ratified threshold.
 *
 * The threshold is NOT lowered here: 0.67 is also the score of Split Squat vs
 * Bulgarian Split Squat, and calling those the same movement would hide a real
 * substitution behind a false match.
 */
export function sameExercise(a: string, b: string): boolean {
  if (normalizeExerciseName(a) === normalizeExerciseName(b)) return true;
  return nameMatchScore(a, b) >= DEFAULT_MATCH_THRESHOLD;
}

function findPair<T extends { name: string }>(pool: T[], name: string): T | undefined {
  return pool.find((p) => sameExercise(p.name, name));
}

/** One session against the day it was supposed to be. */
export function diffSession(
  planned: PlannedExercise[],
  session: PerformedSession,
): SessionDiff {
  const added: PerformedExercise[] = [];
  const setChanges: SessionDiff["setChanges"] = [];

  for (const performed of session.exercises) {
    const match = findPair(planned, performed.name);
    if (!match) {
      added.push(performed);
      continue;
    }
    // A prescribed set count of null means the plan did not say, so there is
    // nothing to have deviated from.
    if (match.sets != null && match.sets !== performed.sets) {
      setChanges.push({
        name: match.name,
        plannedSets: match.sets,
        performedSets: performed.sets,
      });
    }
  }

  const dropped = planned.filter((p) => !findPair(session.exercises, p.name));

  return {
    completedWorkoutId: session.completedWorkoutId,
    dayIndex: session.dayIndex,
    completedAt: session.completedAt,
    added,
    dropped,
    setChanges,
  };
}

function tally(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of names) {
    // Fold to whichever spelling was seen first, so one movement is one row.
    const existing = [...counts.keys()].find((k) => sameExercise(k, n));
    const key = existing ?? n;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Roll every session of one routine day into a pattern.
 *
 * A pattern is what is worth telling somebody about: "you added this twice" is
 * a habit, "you added this once" is a Tuesday. Callers decide what to surface;
 * this reports the counts and the session total so a one-off is distinguishable
 * from a habit.
 */
export function summarizeDay(
  dayIndex: number,
  workoutName: string | null,
  planned: PlannedExercise[],
  sessions: PerformedSession[],
): DayPattern {
  const diffs = sessions.map((s) => diffSession(planned, s));

  const added = [...tally(diffs.flatMap((d) => d.added.map((a) => a.name)))]
    .map(([name, timesAdded]) => ({ name, timesAdded }))
    .sort((a, b) => b.timesAdded - a.timesAdded);

  const dropped = [...tally(diffs.flatMap((d) => d.dropped.map((x) => x.name)))]
    .map(([name, timesDropped]) => ({ name, timesDropped }))
    .sort((a, b) => b.timesDropped - a.timesDropped);

  // A set-count change counts only when the user landed on the SAME number
  // more than the plan's: drifting 4, 5, 4 is noise, doing 5 every time is a
  // decision.
  const byName = new Map<string, { plannedSets: number; performed: number[] }>();
  for (const d of diffs) {
    for (const c of d.setChanges) {
      const existingKey = [...byName.keys()].find((k) => sameExercise(k, c.name));
      const key = existingKey ?? c.name;
      const entry = byName.get(key) ?? { plannedSets: c.plannedSets, performed: [] };
      entry.performed.push(c.performedSets);
      byName.set(key, entry);
    }
  }
  const setChanges: DayPattern["setChanges"] = [];
  for (const [name, { plannedSets, performed }] of byName) {
    const counts = tally(performed.map(String));
    const [typical, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    setChanges.push({
      name,
      plannedSets,
      typicalSets: Number(typical),
      sessions: n,
    });
  }

  return {
    dayIndex,
    workoutName,
    sessionCount: sessions.length,
    added,
    dropped,
    setChanges,
  };
}

export function summarizeAdherence(
  routineName: string,
  days: {
    dayIndex: number;
    workoutName: string | null;
    planned: PlannedExercise[];
    sessions: PerformedSession[];
  }[],
): AdherenceSummary {
  const patterns = days
    .filter((d) => d.sessions.length > 0)
    .map((d) => summarizeDay(d.dayIndex, d.workoutName, d.planned, d.sessions));

  const sessionsCompleted = days.reduce((a, d) => a + d.sessions.length, 0);

  return {
    routineName,
    sessionsCompleted,
    daysWithData: patterns.length,
    patterns,
    noData: sessionsCompleted === 0,
  };
}
