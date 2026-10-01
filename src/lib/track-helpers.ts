import { lbsToDisplay, type WeightUnit } from "@/lib/units";
import type { SetData } from "@/lib/workout-stats";
import { usesDistance } from "@/lib/exercise-types";

// Minimal shape the track defaults need from a completed workout. The real
// records carry much more; we only read completedAt + the inline exercises.
type CompletedForTrack = {
  completedAt: Date;
  exercises: Array<Record<string, unknown>>;
};

export interface LastRecorded {
  weight: number | null;
  reps: number | null;
  distance: number | null;
  time: number | null;
  /**
   * The whole of the most recent session, for READING. The four fields above
   * are one set chosen for the prefill; a person asking "what did I do last
   * time" wants every set, in order. Additive and optional, so the prefill
   * cannot be affected by it.
   */
  lastSession?: LastSession;
}

export type LastSession = {
  /** The viewer's local day, "YYYY-MM-DD". */
  date: string;
  workoutName: string;
  sets: Array<{
    weightLbs: number | null;
    reps: number | null;
    time: number | null;
    distance: number | null;
  }>;
};

/**
 * "135 x 8, 135 x 8, 135 x 6 lbs" - last session's sets as one readable line.
 *
 * Follows what the exercise MEASURES, never its type name (the house rule in
 * lib/exercise-types): a hold reads "60s at 25", cardio "1.5 mi in 12 min", a
 * bodyweight set "BW x 10", and an assisted lift says "assist" because its
 * weight is help, not load. Weights are converted from lbs by the caller's
 * `toDisplay`, so the line reads in the unit everything else on screen does.
 */
export function formatLastSessionSets(
  session: LastSession,
  opts: {
    unit: string;
    toDisplay: (lbs: number | null) => number | null;
    usesWeight: boolean;
    usesReps: boolean;
    usesTime: boolean;
    usesDistance: boolean;
    assisted?: boolean;
  },
): string {
  const parts = session.sets.map((s) => {
    const w = opts.toDisplay(s.weightLbs ?? 0) ?? 0;
    if (opts.usesDistance) {
      const d = s.distance ?? 0;
      const t = s.time ?? 0;
      return t > 0 ? `${d} mi in ${t} min` : `${d} mi`;
    }
    if (opts.usesTime && !opts.usesReps) {
      // The unit sits beside the load here, because a hold's sets are not all
      // loaded and a trailing unit would land after a bare "45s".
      const t = s.time ?? 0;
      return w > 0 ? `${t}s at ${w} ${opts.unit}` : `${t}s`;
    }
    const reps = s.reps ?? 0;
    if (!opts.usesWeight || w <= 0) return `BW x ${reps}`;
    return opts.assisted ? `${w} assist x ${reps}` : `${w} x ${reps}`;
  });
  const anyLoad = session.sets.some((s) => (s.weightLbs ?? 0) > 0);
  const isHold = opts.usesTime && !opts.usesReps && !opts.usesDistance;
  const unitSuffix = opts.usesWeight && anyLoad && !opts.usesDistance && !isHold ? ` ${opts.unit}` : "";
  return `${parts.join(", ")}${unitSuffix}`;
}

/** "Sep 24", or "Sep 24, 2025" when it was not this year. */
export function formatSessionDate(dateKey: string, todayKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const base = `${months[(m ?? 1) - 1]} ${d}`;
  return todayKey.slice(0, 4) === String(y) ? base : `${base}, ${y}`;
}

/**
 * The best set for an exercise from the most recent completed workout that
 * contained it. "Best" = highest weight, tie-broken by longest distance (so
 * distance/time exercises still surface a sensible last value). Weights stay in
 * lbs (DB units); the caller converts for display.
 */
export function getLastRecordedValues(
  completedWorkouts: CompletedForTrack[],
  exerciseId: string,
): LastRecorded | null {
  const sortedWorkouts = [...completedWorkouts].sort(
    (a, b) => b.completedAt.getTime() - a.completedAt.getTime(),
  );

  for (const workout of sortedWorkouts) {
    const exercise = workout.exercises.find(
      (ex) => (ex as { id?: string }).id === exerciseId,
    ) as { setsData?: Array<Record<string, number | null>> } | undefined;
    if (exercise?.setsData && exercise.setsData.length > 0) {
      const best = pickLastRecorded(exercise.setsData);
      if (best) return best;
    }
  }
  return null;
}

/**
 * The best set out of one exercise's sets: highest weight, tie-broken by
 * longest distance so a distance/time exercise still surfaces something
 * sensible. Completed sets only.
 *
 * Extracted so `/api/exercises/last-values` ranks identically. The tracker used
 * to answer this in the browser by walking the user's entire history, which is
 * why every page loaded every set ever logged; the server answers it now, and
 * sharing this function is what stops the prefilled number from drifting.
 */
export function pickLastRecorded(
  setsData: Array<Record<string, number | null>>,
): LastRecorded | null {
  const completedSets = setsData.filter((s) => s.completed);
  if (completedSets.length === 0) return null;
  const bestSet = completedSets.reduce((best, s) => {
    const sWeight = s.weight ?? 0;
    const bestWeight = best.weight ?? 0;
    const sDistance = s.distance ?? 0;
    const bestDistance = best.distance ?? 0;
    if (sWeight !== bestWeight) return sWeight > bestWeight ? s : best;
    return sDistance > bestDistance ? s : best;
  });
  return {
    weight: bestSet.weight ?? null,
    reps: bestSet.reps ?? null,
    distance: bestSet.distance ?? null,
    time: bestSet.time ?? null,
  };
}

/**
 * A per-exercise prescription to seed the starting rows with. FitBot-generated
 * workouts pass this so a "4 × 12" exercise opens with 4 rows (not the default
 * 3) and the target reps pre-filled. Omitted for normal workouts, which keep the
 * historic 1-or-3 default. Recorded history always wins on the first row's
 * values (your real last performance beats a generic target).
 */
export interface SetPlan {
  sets?: number; // planned number of set rows
  reps?: number | null; // planned target reps for weight_reps exercises
  // Planned target load in lbs (DB units) for weight_reps exercises — the
  // deterministic per-week anchor load a FitBot program prescribes. Prefills
  // the first row's weight (converted to the display unit) when there's no
  // recorded history. History still wins on row 0.
  targetLoadLbs?: number | null;
}

/**
 * The starting set rows for an exercise on the track screen. Prefills the first
 * set from the exercise's last recorded values (converted to the display unit);
 * distance/time exercises default to 1 set, weight/reps to 3. When a `plan` is
 * given (FitBot workouts), the row count follows the plan's set count and, when
 * there's no recorded history, the first row's reps are pre-filled from the
 * plan's target reps.
 */
/**
 * Takes the last recorded values DIRECTLY rather than the whole history.
 *
 * It used to accept every completed workout and find them itself, which is why
 * the tracker needed the user's entire set history in memory.
 * `/api/exercises/last-values` answers that for the workout's exercises now,
 * and the caller passes the answer in.
 */
export function getDefaultSets(
  lastValues: LastRecorded | null,
  weightUnit: WeightUnit,
  exerciseType?: string,
  plan?: SetPlan,
): SetData[] {

  const isDistanceTime = usesDistance(exerciseType);
  // A loaded hold is a normal multi-set exercise, so it gets the usual 3 rows;
  // only a cardio bout defaults to a single row.
  const rowCount = Math.max(1, plan?.sets ?? (isDistanceTime ? 1 : 3));

  return Array.from({ length: rowCount }, (_, i) => {
    if (i === 0 && lastValues) {
      return {
        setNumber: 1,
        weight: lbsToDisplay(lastValues.weight, weightUnit),
        reps: lastValues.reps,
        distance: lastValues.distance,
        time: lastValues.time,
        completed: false,
      };
    }
    // No history: pre-fill the first row from the plan's target (weight/reps
    // only) — reps from plan.reps (FitBot single-workout) and/or weight from
    // plan.targetLoadLbs (FitBot program day), converted to the display unit.
    if (i === 0 && !isDistanceTime && (plan?.reps != null || plan?.targetLoadLbs != null)) {
      return {
        setNumber: 1,
        weight: plan?.targetLoadLbs != null ? lbsToDisplay(plan.targetLoadLbs, weightUnit) : null,
        reps: plan?.reps ?? null,
        distance: null,
        time: null,
        completed: false,
      };
    }
    return { setNumber: i + 1, weight: null, reps: null, distance: null, time: null, completed: false };
  });
}

/**
 * A program's prescribed reps, which is a STRING ("8", "6-8", "AMRAP", "30s"),
 * not a number. Importers and FitBot both write prescriptions this way because
 * that is how programs are actually written.
 *
 * Returns the label to SHOW the user verbatim, plus a number to prefill the
 * first row with when one can be read out of it. A range prefills its LOW end -
 * the target is to reach the top of the range, so starting there would have the
 * user log the best case before doing the work. Anything unparseable ("AMRAP")
 * prefills nothing and is still shown.
 */
export function parseRepsPrescription(
  reps: string | number | null | undefined,
): { label: string | null; prefillReps: number | null } {
  if (reps == null) return { label: null, prefillReps: null };
  if (typeof reps === "number") {
    return Number.isFinite(reps) ? { label: String(reps), prefillReps: reps } : { label: null, prefillReps: null };
  }
  const label = reps.trim();
  if (!label) return { label: null, prefillReps: null };
  // First integer in the string: "6-8" -> 6, "8-12 each side" -> 8, "AMRAP" -> none.
  const m = label.match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  return {
    label,
    prefillReps: Number.isFinite(n) && n > 0 && n <= 1000 ? n : null,
  };
}

/** Human target line for the tracker: "3 sets x 6-8 reps", omitting absent parts. */
export function formatTargetLine(
  plan: { sets?: number | null; repsLabel?: string | null } | undefined,
): string | null {
  if (!plan) return null;
  const parts: string[] = [];
  if (plan.sets != null && plan.sets > 0) parts.push(`${plan.sets} ${plan.sets === 1 ? "set" : "sets"}`);
  if (plan.repsLabel) parts.push(`${plan.repsLabel} reps`);
  return parts.length ? parts.join(" x ") : null;
}
