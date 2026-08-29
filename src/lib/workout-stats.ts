import { localDateKey, localDateKeyInZone } from "@/lib/date";

// These operate on the ASSEMBLED workout shape (exercises[] built from the
// normalized tables), not a raw DB row — so they're typed locally rather than
// Pick<CompletedWorkout, ...>. Since Phase 4d the completed_workouts row has no
// `exercises` column at all.
export interface WorkoutForSummary {
  exercises: unknown;
  completedAt: Date | string;
  startedAt: Date | string | null;
  durationSeconds: number | null;
}

export interface SetData {
  setNumber: number;
  weight: number | null;
  reps: number | null;
  distance: number | null;
  time: number | null;
  completed: boolean;
}

export interface ExerciseInWorkout {
  id: string;
  name: string;
  muscleGroups?: string[];
  setsData?: SetData[];
  completedSets?: number;
  sets?: number;
}

export interface WorkoutSummary {
  durationSeconds: number | null;
  totalSets: number;
  totalVolumeLbs: number;
  exerciseCount: number;
  muscleGroups: Map<string, number>; // muscleGroup → sets count
}

export function summarizeWorkout(
  workout: WorkoutForSummary,
): WorkoutSummary {
  const exercises = (workout.exercises as ExerciseInWorkout[]) || [];
  let totalSets = 0;
  let totalVolume = 0;
  const muscleGroups = new Map<string, number>();

  for (const ex of exercises) {
    const setsData = ex.setsData ?? [];
    const completedSets = setsData.filter((s) => s.completed);
    totalSets += completedSets.length;
    for (const s of completedSets) {
      totalVolume += (s.weight || 0) * (s.reps || 0);
    }
    if (ex.muscleGroups?.length && completedSets.length) {
      for (const mg of ex.muscleGroups) {
        muscleGroups.set(mg, (muscleGroups.get(mg) || 0) + completedSets.length);
      }
    }
  }

  const durationSeconds =
    workout.durationSeconds ??
    (workout.startedAt
      ? Math.max(
          0,
          Math.floor(
            (new Date(workout.completedAt).getTime() -
              new Date(workout.startedAt).getTime()) /
              1000,
          ),
        )
      : null);

  return {
    durationSeconds,
    totalSets,
    totalVolumeLbs: totalVolume,
    // Exercises actually TRAINED. Counting every row meant a workout where you
    // opened 9 exercises but logged 5 reported "Exercises 9" next to a set
    // count that only included the 5.
    exerciseCount: exercises.filter((ex) =>
      (ex.setsData ?? []).some((s) => s.completed),
    ).length,
    muscleGroups,
  };
}

/**
 * Auto-generate a workout name from the muscle groups trained, e.g.
 * "Back & Biceps". Used when the user starts a workout without naming it
 * (the new quick-start flow). Ranks groups by completed-set count and joins
 * the top two with " & ". Falls back to mere presence (exercise has the group)
 * when no sets are completed yet, and returns "" when there's no muscle data
 * at all (caller substitutes a generic name like "Quick Workout").
 */
export function deriveWorkoutName(
  exercises: Pick<ExerciseInWorkout, "muscleGroups" | "setsData">[],
): string {
  const byCompleted = new Map<string, number>();
  const byPresence = new Map<string, number>();
  for (const ex of exercises) {
    const groups = ex.muscleGroups ?? [];
    if (!groups.length) continue;
    const completed = (ex.setsData ?? []).filter((s) => s.completed).length;
    for (const g of groups) {
      byPresence.set(g, (byPresence.get(g) ?? 0) + 1);
      if (completed > 0) byCompleted.set(g, (byCompleted.get(g) ?? 0) + completed);
    }
  }
  const source = byCompleted.size > 0 ? byCompleted : byPresence;
  // Map iteration + Array.sort are stable, so ties break by first occurrence.
  const top = [...source.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([group]) => group);
  return top.join(" & ");
}

/**
 * True when an exercise is a pull-up / push-up movement in any naming variant
 * ("Pull-ups", "Pull Ups Assisted", "Pushups", "Knee Pushups") — the high-rep
 * bodyweight lifts where a running session total is meaningful, so the Track
 * screen shows a live total-reps counter for them. Deliberately does NOT match
 * pulldowns, push downs, pull-aparts, or pull-throughs.
 */
export function isRepTotalExercise(name: string | null | undefined): boolean {
  if (!name) return false;
  const norm = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return /\bpull ?ups?\b|\bpush ?ups?\b/.test(norm);
}

/**
 * Total reps across every COMPLETED set in the given set lists (one list per
 * exercise instance). Uncompleted rows and null reps count 0.
 */
export function totalCompletedReps(setLists: SetData[][]): number {
  let total = 0;
  for (const sets of setLists) {
    for (const s of sets) {
      if (s.completed) total += s.reps ?? 0;
    }
  }
  return total;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function calcStreak(completedAtList: Date[], timeZone?: string): number {
  if (!completedAtList.length) return 0;
  // Bucket completed_at into local-date keys. `timeZone` is REQUIRED from
  // server components: without it the keys come from the runtime clock, which
  // is UTC on Vercel, so evening workouts landed on the next day and an
  // evening + next-morning pair collapsed into one, undercounting the streak.
  const key = (d: Date) =>
    timeZone ? localDateKeyInZone(d, timeZone) : localDateKey(d);
  const days = new Set(completedAtList.map((d) => key(new Date(d))));
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const cursor = new Date(today);
    cursor.setDate(today.getDate() - i);
    const cursorKey = key(cursor);
    if (days.has(cursorKey)) {
      streak++;
    } else if (i === 0) {
      // Today doesn't count yet — keep checking yesterday
      continue;
    } else {
      break;
    }
  }
  return streak;
}

export interface PrHit {
  exerciseId: string;
  exerciseName: string;
  type: "weight" | "volume";
  newValue: number;
  previousValue: number | null;
}

/**
 * Detect PRs in `currentWorkout` versus the user's prior history.
 *
 * For normal exercises (isAssisted = false): higher weight + higher volume = PR.
 *
 * For assisted exercises (isAssisted = true — e.g. assisted pull-up machine):
 * lower weight = PR, because the "weight" is the counter-weight that's helping
 * you. Less help = harder lift. Volume PR is skipped for assisted (the formula
 * weight*reps no longer represents work done; mixing it with normal volume
 * PRs would give false positives every time someone reduced assistance).
 *
 * `isAssistedById` maps exercise id → isAssisted. Exercises not in the map
 * default to false (normal).
 */
export function detectPRs(
  currentWorkout: { exercises: unknown },
  priorWorkouts: { exercises: unknown }[],
  isAssistedById: Map<string, boolean> = new Map(),
): PrHit[] {
  // For normal exercises we track MAX; for assisted we track MIN (over
  // non-zero weights only, since "0 lbs assist" is a degenerate seed value).
  const histBestWeight = new Map<string, number>(); // max OR min by mode
  const histMaxVolume = new Map<string, number>();

  for (const w of priorWorkouts) {
    const exs = (w.exercises as ExerciseInWorkout[]) || [];
    for (const ex of exs) {
      const assisted = isAssistedById.get(ex.id) === true;
      for (const s of ex.setsData ?? []) {
        if (!s.completed) continue;
        const wt = s.weight || 0;
        if (wt <= 0) continue; // ignore zero-weight rows for best-tracking
        const cur = histBestWeight.get(ex.id);
        if (assisted) {
          if (cur === undefined || wt < cur) histBestWeight.set(ex.id, wt);
        } else {
          if (cur === undefined || wt > cur) histBestWeight.set(ex.id, wt);
          const vol = wt * (s.reps || 0);
          const curMaxVol = histMaxVolume.get(ex.id) ?? 0;
          if (vol > curMaxVol) histMaxVolume.set(ex.id, vol);
        }
      }
    }
  }

  const hits: PrHit[] = [];
  const currentExs = (currentWorkout.exercises as ExerciseInWorkout[]) || [];
  for (const ex of currentExs) {
    const assisted = isAssistedById.get(ex.id) === true;
    let bestWt = assisted ? Number.POSITIVE_INFINITY : 0;
    let bestVol = 0;
    let bestVolReps = 0;
    let anyWeighted = false;
    for (const s of ex.setsData ?? []) {
      if (!s.completed) continue;
      const wt = s.weight || 0;
      if (wt <= 0) continue;
      anyWeighted = true;
      if (assisted) {
        if (wt < bestWt) bestWt = wt;
      } else {
        if (wt > bestWt) bestWt = wt;
        const vol = wt * (s.reps || 0);
        if (vol > bestVol) {
          bestVol = vol;
          bestVolReps = s.reps || 0;
        }
      }
    }
    if (!anyWeighted) continue;
    const prev = histBestWeight.get(ex.id);
    const prevWt = prev ?? null;
    // Epsilon-guarded, matching the in-workout toast (use-pr-detection). A kg
    // user's lbs -> kg -> lbs round trip drifts up to ~0.11 lb, so a strict
    // comparison persisted a phantom "100.1 was 100" PR to pr_history and put
    // it on the complete screen even where the toast was correctly suppressed.
    const isWeightPr = assisted
      ? prev === undefined || bestWt < prev - PR_EPSILON_LBS
      : prev === undefined || bestWt > prev + PR_EPSILON_LBS;
    if (isWeightPr) {
      hits.push({
        exerciseId: ex.id,
        exerciseName: ex.name,
        type: "weight",
        newValue: bestWt,
        previousValue: prevWt,
      });
    }
    // Volume PR only meaningful for non-assisted exercises
    if (!assisted) {
      const prevVol = histMaxVolume.get(ex.id) ?? null;
      // Volume drift is the weight drift times the rep count, so a flat epsilon
      // is too small at anything above ~3 reps; scale it by the reps behind the
      // best set.
      const volEpsilon = PR_EPSILON_LBS * Math.max(1, bestVolReps);
      if (bestVol > 0 && (prevVol === null || bestVol > prevVol + volEpsilon)) {
        hits.push({
          exerciseId: ex.id,
          exerciseName: ex.name,
          type: "volume",
          newValue: bestVol,
          previousValue: prevVol,
        });
      }
    }
  }
  return hits;
}

/**
 * lbs -> kg -> lbs rounds each way, so an unchanged weight can come back up to
 * ~0.11 lb heavier for a kg user. Comparisons are guarded by this margin so a
 * re-logged prefill never reads as a new record.
 */
export const PR_EPSILON_LBS = 0.25;

/**
 * Epley is only meaningful in the low-rep range, so reps are clamped before the
 * estimate. Without a clamp a 95 lb x 40-rep accessory set reported a 221 lb
 * "1RM" on the exercise page, the records card, and the strength trend.
 */
export const EPLEY_MAX_REPS = 12;

/** Epley one-rep-max estimate: weight x (1 + reps/30), reps clamped. */
export function epley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + Math.min(reps, EPLEY_MAX_REPS) / 30);
}

/**
 * Which sets in ONE exercise instance currently hold a record.
 *
 * PR badges used to be accumulated: a set was marked the moment it beat the
 * running best and the marker was never revisited. Two things followed, both
 * reported by Ivo (2026-08-28):
 *   - Working up 5 lb -> 10 lb badged BOTH sets, when only the 10 is the record.
 *   - Correcting a mistyped 10 back to 5 left the badge behind, so the workout
 *     claimed a PR that no set in it had achieved.
 *
 * So this is a pure function of the CURRENT sets instead. Recomputing on every
 * change makes an edit self-correcting and keeps the badge on the one set that
 * actually holds the record. Ties keep the EARLIEST set: the record was set
 * there, and a later matching set did not beat it.
 *
 * Weights are lbs (DB units). `assisted` inverts the weight direction, because
 * less counterweight is harder; volume is meaningless there and is skipped,
 * matching detectPRs and the records endpoint.
 */
export function prSetIndices(
  sets: Array<Pick<SetData, "weight" | "reps" | "completed">>,
  histBestWeight: number | undefined,
  histMaxVolume: number | undefined,
  assisted: boolean,
): Set<number> {
  const marks = new Set<number>();

  let bestWeight = histBestWeight;
  let bestWeightIdx = -1;
  let bestVolume = histMaxVolume;
  let bestVolumeIdx = -1;

  for (let i = 0; i < sets.length; i++) {
    const s = sets[i];
    if (!s.completed) continue;
    const w = s.weight ?? 0;
    const r = s.reps ?? 0;
    if (w <= 0 || r <= 0) continue;

    const beatsWeight = assisted
      ? bestWeight === undefined || w < bestWeight - PR_EPSILON_LBS
      : bestWeight === undefined || w > bestWeight + PR_EPSILON_LBS;
    if (beatsWeight) {
      bestWeight = w;
      bestWeightIdx = i;
    }

    if (!assisted) {
      const vol = w * r;
      // Volume drift scales with reps, so the margin does too - a flat one is
      // too small above ~3 reps and a re-logged prefill reads as a record.
      const volEpsilon = PR_EPSILON_LBS * Math.max(1, r);
      if (bestVolume === undefined || vol > bestVolume + volEpsilon) {
        bestVolume = vol;
        bestVolumeIdx = i;
      }
    }
  }

  if (bestWeightIdx >= 0) marks.add(bestWeightIdx);
  if (bestVolumeIdx >= 0) marks.add(bestVolumeIdx);
  return marks;
}
