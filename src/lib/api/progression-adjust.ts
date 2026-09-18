import { round1 } from "@/lib/units";
import { effectiveRule, type MaybeRule, type ProgressionRule } from "@/lib/progression";

/**
 * Hold the weight on the next session when this one fell short.
 *
 * Ivo, 2026-09-18, asked for this explicitly: a program that keeps adding
 * weight to a lift you are already missing is worse than one that holds, and it
 * is what makes linear progression fall apart in week six rather than week two.
 *
 * WHY HERE, on the completed-workout save, rather than when the next session is
 * read. The read path is `loadScheduledWorkouts`, which also feeds Home's
 * server-rendered first paint - a payload that was cut from 12 API calls and
 * 90KB down to 7 and 34KB, and adding a per-exercise history lookup to it would
 * hand that back. Finishing a workout happens once, already has the sets in
 * hand, and already runs an `after()` block. So the adjustment is WRITTEN onto
 * the next occurrence instead of computed on every read.
 *
 * Only the NEXT occurrence is touched, deliberately. Re-deciding each time you
 * train is the honest behaviour: one short session is not a stall, and a user
 * who comes back and hits the reps should climb again immediately rather than
 * carrying a penalty forward through a program they have already recovered
 * from.
 */

export type PerformedSet = {
  name: string;
  weightLbs: number | null;
  reps: number | null;
  completed: boolean;
};

/** The heaviest completed set per exercise, which is what a target is judged against. */
export function topSetsByExercise(sets: PerformedSet[]): Map<string, { weightLbs: number; reps: number }> {
  const out = new Map<string, { weightLbs: number; reps: number }>();
  for (const s of sets) {
    if (!s.completed || !s.name) continue;
    const w = typeof s.weightLbs === "number" ? s.weightLbs : 0;
    const r = typeof s.reps === "number" ? s.reps : 0;
    const prev = out.get(s.name);
    if (!prev || w > prev.weightLbs) out.set(s.name, { weightLbs: w, reps: r });
  }
  return out;
}

/**
 * Parse the LOW end of a prescription for comparison only.
 *
 * Reps are a STRING by contract - "6-8", "AMRAP", "30s" - and are shown
 * verbatim everywhere. Collapsing a range is exactly the bug the string type
 * exists to prevent, so this is used ONLY to decide whether somebody fell
 * short, never written back. "AMRAP" yields null, because there is no target to
 * miss.
 */
export function lowRepTarget(reps: unknown): number | null {
  if (typeof reps === "number" && Number.isFinite(reps)) return reps;
  if (typeof reps !== "string") return null;
  const m = reps.match(/\d+/);
  if (!m) return null;
  // A time prescription is not a rep count.
  if (/s\b|sec|min/i.test(reps)) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Should the next session hold, and at what weight?
 *
 * Deliberately NOT `resolveTarget` from lib/progression. That one takes a
 * STARTING load and computes the climb; here the climb has already been
 * computed and baked into the scheduled row, so the question is only whether to
 * honour it. Passing the already-climbed number in as the base made the hold
 * floor at the very weight it was supposed to hold below - the function
 * returned `max(planned, lifted)`, which is just `planned` whenever somebody
 * fell short. Caught before it ran; the shapes look interchangeable and are not.
 *
 * Holds at what they ACTUALLY lifted, never lower: repeating a week is the
 * worst case, and a surprise drop in prescribed weight reads as a bug.
 */
export function heldTarget(
  plannedLbs: number,
  rule: ProgressionRule,
  top: { weightLbs: number; reps: number },
  targetReps: number | null,
): number | null {
  if (targetReps == null) return null;
  if (top.reps >= targetReps) return null;
  // Only a shortfall at or near the load being prescribed is evidence. Missing
  // reps on a much lighter day says nothing about the next step up.
  if (top.weightLbs < plannedLbs - rule.incrementLbs) return null;
  const held = round1(Math.min(plannedLbs, Math.max(top.weightLbs, 0)));
  return held < plannedLbs ? held : null;
}

/**
 * Decide the next occurrence's targets, exercise by exercise.
 *
 * Each exercise is judged against ITS OWN rule: a per-exercise override beats
 * the routine default whole, exactly as it does when the session was scheduled.
 * This used to receive the routine default only, so an exercise with a rule of
 * its own was judged against a rule it does not follow - and with no routine
 * default at all nothing held, whatever the exercise's own rule said.
 *
 * An assisted lift is skipped for the reason `progressedExercises` never climbs
 * one: its weight is assistance, so "hold at what you lifted" points the wrong
 * way.
 *
 * Returns null when nothing changed, so the caller writes only when it must.
 */
export function holdExercises(
  exercises: Record<string, unknown>[],
  routineRule: MaybeRule,
  performed: PerformedSet[],
  isAssisted: (ex: Record<string, unknown>) => boolean = () => false,
): Record<string, unknown>[] | null {
  const tops = topSetsByExercise(performed);
  let changed = false;

  const updated = exercises.map((ex) => {
    const name = typeof ex.name === "string" ? ex.name : "";
    const planned = Number(ex.targetLoadLbs);
    const top = tops.get(name);
    if (!name || !top || !Number.isFinite(planned) || planned <= 0) return ex;
    if (isAssisted(ex)) return ex;
    const rule = effectiveRule(routineRule, ex.progression as MaybeRule);
    if (!rule) return ex;

    const held = heldTarget(planned, rule, top, lowRepTarget(ex.reps));
    if (held == null) return ex;
    changed = true;
    return { ...ex, targetLoadLbs: held, progressionHeld: true };
  });

  return changed ? updated : null;
}

/**
 * Re-decide the next occurrence's targets in light of what just happened.
 *
 * Swallows its own failure: this runs after the response, and a workout that
 * saved correctly must not be reported as broken because a future session's
 * suggested weight could not be adjusted.
 */
export async function adjustNextOccurrence(opts: {
  userId: string;
  routineInstanceId: string;
  routineDayIndex: number;
  completedAt: Date;
  /** The ROUTINE's default, unresolved. Each exercise's own rule is applied inside. */
  routineRule: MaybeRule;
  performed: PerformedSet[];
}): Promise<void> {
  const { userId, routineInstanceId, routineDayIndex, completedAt, routineRule, performed } = opts;

  try {
    // Imported LAZILY: `lib/db` throws at module load without DATABASE_URL,
    // which is the unit-test environment, and that would make every pure helper
    // in this file untestable for the sake of one function that needs it.
    const [{ db }, { scheduledWorkouts }, { and, asc, eq, gt }, { loadAssistedCheck }] =
      await Promise.all([
        import("@/lib/db"),
        import("@/lib/db/schema"),
        import("drizzle-orm"),
        import("@/lib/api/assisted"),
      ]);

    const [next] = await db
      .select()
      .from(scheduledWorkouts)
      // userId-scoped: `routineInstanceId` is a plain varchar with no foreign
      // key, so without it another user's rows carrying the same id would be
      // reachable.
      .where(
        and(
          eq(scheduledWorkouts.userId, userId),
          eq(scheduledWorkouts.routineInstanceId, routineInstanceId),
          eq(scheduledWorkouts.routineDayIndex, routineDayIndex),
          gt(scheduledWorkouts.date, completedAt),
        ),
      )
      .orderBy(asc(scheduledWorkouts.date))
      .limit(1);

    if (!next || !Array.isArray(next.exercises)) return;

    const updated = holdExercises(
      next.exercises as Record<string, unknown>[],
      routineRule,
      performed,
      await loadAssistedCheck(),
    );
    if (!updated) return;
    await db
      .update(scheduledWorkouts)
      .set({ exercises: updated })
      .where(eq(scheduledWorkouts.id, next.id));
  } catch (e) {
    console.error("[progression] could not adjust the next session:", e);
  }
}
