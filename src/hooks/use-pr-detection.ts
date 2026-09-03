"use client";

import { useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { displayToLbs, lbsToDisplay, type WeightUnit } from "@/lib/units";
import {
  PR_EPSILON_LBS,
  beatsHold,
  prSetIndices,
  type BestHold,
  type SetData,
} from "@/lib/workout-stats";
import { usesDistance, usesTime } from "@/lib/exercise-types";
import { hapticSuccess } from "@/lib/native-feedback";

interface ExerciseLite {
  id: string;
  isAssisted?: boolean | null;
  exerciseType?: string | null;
}

/**
 * In-workout PR detection engine, extracted verbatim from TrackPage.
 *
 * Builds historical bests per exercise (max weight for normal exercises, MIN
 * weight for assisted — less counterweight = harder). Volume PRs are skipped
 * for assisted exercises.
 *
 * TWO SEPARATE THINGS, deliberately:
 *   - `checkForPRs` fires the TOAST. That is an event: it happens at the moment
 *     a set is completed and beats the best, and it is correct that it cannot
 *     be un-fired.
 *   - `prSetMarkers` is the BADGE, and is DERIVED from the current sets rather
 *     than accumulated. It used to be a Set written at completion time and
 *     never revisited, which badged every set on the way up (5 lb and 10 lb
 *     both, when only the 10 is the record) and left a badge behind when a
 *     mistyped weight was corrected back down. Deriving it makes an edit
 *     self-correcting. See prSetIndices.
 */
export function usePrDetection(
  completedWorkouts: Array<{ exercises: unknown[] }>,
  exercises: ExerciseLite[],
  weightUnit: WeightUnit,
) {
  // isAssisted lookup — assisted exercises INVERT weight PR direction.
  const isAssistedById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const ex of exercises) m.set(ex.id, !!ex.isAssisted);
    return m;
  }, [exercises]);

  const isHoldById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const ex of exercises) {
      m.set(ex.id, usesTime(ex.exerciseType) && !usesDistance(ex.exerciseType));
    }
    return m;
  }, [exercises]);

  /** Prefer what the workout says; fall back to the catalog if it is loaded. */
  const isHold = useCallback(
    (exerciseType: string | null | undefined, exerciseId: string) => {
      if (exerciseType != null) return usesTime(exerciseType) && !usesDistance(exerciseType);
      return isHoldById.get(exerciseId) === true;
    },
    [isHoldById],
  );

  /**
   * Longest hold per exercise, with the load it was held at. Separate from the
   * weight/volume bests because a hold's load can legitimately be ZERO (a
   * bodyweight hang), which those deliberately discard.
   */
  const historicalHolds = useMemo(() => {
    const best = new Map<string, BestHold>();
    for (const w of completedWorkouts) {
      for (const ex of w.exercises as Array<{
        id: string;
        exerciseType?: string | null;
        setsData?: Array<{ weight?: number | null; time?: number | null; completed?: boolean }>;
      }>) {
        if (!(usesTime(ex.exerciseType) && !usesDistance(ex.exerciseType))) continue;
        for (const s of ex.setsData ?? []) {
          if (!s.completed) continue;
          const secs = s.time || 0;
          if (secs > 0 && beatsHold(secs, s.weight || 0, best.get(ex.id))) {
            best.set(ex.id, { seconds: secs, weightLbs: s.weight || 0 });
          }
        }
      }
    }
    return best;
  }, [completedWorkouts]);

  // Historical bests per exerciseId (in lbs/DB units).
  const historicalBests = useMemo(() => {
    const bests = new Map<string, { bestWeight: number; maxVolume: number; assisted: boolean }>();
    for (const w of completedWorkouts) {
      for (const ex of w.exercises as Array<{ id: string; setsData?: Array<{ weight?: number | null; reps?: number | null; completed?: boolean }> }>) {
        const assisted = isAssistedById.get(ex.id) === true;
        for (const s of ex.setsData ?? []) {
          if (!s.completed) continue;
          const wt = s.weight || 0;
          if (wt <= 0) continue; // ignore zero-weight rows
          const cur = bests.get(ex.id);
          if (!cur) {
            bests.set(ex.id, {
              bestWeight: wt,
              maxVolume: assisted ? 0 : wt * (s.reps || 0),
              assisted,
            });
            continue;
          }
          if (assisted) {
            if (wt < cur.bestWeight) cur.bestWeight = wt;
          } else {
            if (wt > cur.bestWeight) cur.bestWeight = wt;
            const vol = wt * (s.reps || 0);
            if (vol > cur.maxVolume) cur.maxVolume = vol;
          }
        }
      }
    }
    return bests;
  }, [completedWorkouts, isAssistedById]);

  /**
   * Which (instanceId, setIndex) pairs currently HOLD a record — drives the
   * badge. Derived, so editing a set re-evaluates it for free.
   */
  const prSetMarkersFor = useCallback(
    (
      exerciseId: string,
      instanceId: string,
      exerciseSets: Map<string, SetData[]>,
      /**
       * The type as the WORKOUT records it. Passed in rather than looked up,
       * because the catalog is fetched: before it lands, a hold looked like a
       * lift and scored on a weight it does not have, so its PR silently never
       * fired. The workout already carries the type, so this cannot race.
       */
      exerciseType?: string | null,
    ) => {
      const hist = historicalBests.get(exerciseId);
      const assisted = isAssistedById.get(exerciseId) === true;
      const sets = (exerciseSets.get(instanceId) ?? []).map((s) => ({
        weight: displayToLbs(s.weight, weightUnit) ?? 0,
        reps: s.reps ?? 0,
        time: s.time ?? 0,
        completed: !!s.completed,
      }));
      if (isHold(exerciseType, exerciseId)) {
        return prSetIndices(sets, undefined, undefined, false, {
          previousBest: historicalHolds.get(exerciseId),
        });
      }
      return prSetIndices(sets, hist?.bestWeight, assisted ? undefined : hist?.maxVolume, assisted);
    },
    [historicalBests, historicalHolds, isAssistedById, isHold, weightUnit],
  );

  const checkForPRs = useCallback(
    (
      exerciseId: string,
      instanceId: string,
      exerciseName: string,
      setIndex: number,
      setWeightLbs: number,
      setReps: number,
      exerciseSets: Map<string, SetData[]>,
      exerciseType?: string | null,
    ) => {
      // A HOLD is scored on duration, and its load may legitimately be zero, so
      // it cannot pass through the weight/reps guard below.
      if (isHold(exerciseType, exerciseId)) {
        const secs = (exerciseSets.get(instanceId) ?? [])[setIndex]?.time ?? 0;
        const prev = historicalHolds.get(exerciseId);
        if (beatsHold(secs, setWeightLbs, prev)) {
          const load = setWeightLbs > 0 ? ` at ${lbsToDisplay(setWeightLbs, weightUnit)} ${weightUnit}` : "";
          void hapticSuccess();
          toast({
            title: `⏱️ ${exerciseName} — new hold PR!`,
            description: `${secs}s${load}${prev ? ` (was ${prev.seconds}s)` : ""}`,
          });
        }
        return;
      }

      if (setWeightLbs <= 0 || setReps <= 0) return;
      const assisted = isAssistedById.get(exerciseId) === true;
      const volume = setWeightLbs * setReps;
      const hist = historicalBests.get(exerciseId);

      // Running best across earlier sets in THIS workout for the same instance.
      let runningBestWeight = hist?.bestWeight ?? (assisted ? Number.POSITIVE_INFINITY : 0);
      let runningMaxVolume = hist?.maxVolume ?? 0;
      const earlierSets = (exerciseSets.get(instanceId) ?? []).slice(0, setIndex);
      for (const s of earlierSets) {
        if (!s.completed) continue;
        const wLbs = displayToLbs(s.weight, weightUnit) ?? 0;
        if (wLbs <= 0) continue;
        const r = s.reps ?? 0;
        if (assisted) {
          if (wLbs < runningBestWeight) runningBestWeight = wLbs;
        } else {
          if (wLbs > runningBestWeight) runningBestWeight = wLbs;
          const v = wLbs * r;
          if (v > runningMaxVolume) runningMaxVolume = v;
        }
      }

      // PR bests are tracked in lbs (DB units); show them in the user's unit,
      // otherwise a kg user read "132.3 lbs" next to kg everywhere else.
      const fmt = (lbs: number) => `${lbsToDisplay(lbs, weightUnit)} ${weightUnit}`;

      let isPr = false;
      // Tolerance, because lbs -> kg -> lbs is not exactly idempotent: both
      // conversions round to 1 decimal, so re-logging an unchanged prefilled
      // 100 lb set as a kg user comes back as 100.1 and used to fire a phantom
      // "new PR" (and the inverse on assisted lifts, where lower is better).
      // A real plate change is at least 1 lb / 0.5 kg.
      // Shared with detectPRs so the in-workout toast and the complete screen
      // agree on what counts as a record.
      const isWeightPr = assisted
        ? runningBestWeight === Number.POSITIVE_INFINITY ||
          setWeightLbs < runningBestWeight - PR_EPSILON_LBS
        : setWeightLbs > runningBestWeight + PR_EPSILON_LBS;
      if (isWeightPr) {
        isPr = true;
        const prevLabel = !isFinite(runningBestWeight) || runningBestWeight === 0
          ? "—"
          : fmt(runningBestWeight);
        void hapticSuccess();
        toast({
          title: `🏆 ${exerciseName} — new weight PR!`,
          description: assisted
            ? `${fmt(setWeightLbs)} assist (was ${prevLabel}) — less help = harder`
            : `${fmt(setWeightLbs)} (was ${prevLabel})`,
        });
      }
      // Volume PR only meaningful for non-assisted exercises
      // Volume drift scales with reps, so the flat margin was too small above
      // ~3 reps and a re-logged prefill fired a phantom volume PR.
      if (!assisted && volume > runningMaxVolume + PR_EPSILON_LBS * Math.max(1, setReps)) {
        isPr = true;
        void hapticSuccess();
        toast({
          title: `⭐ ${exerciseName} — new volume PR!`,
          description: `${fmt(setWeightLbs)} × ${setReps} = ${fmt(volume)} (was ${runningMaxVolume ? fmt(runningMaxVolume) : "—"})`,
        });
      }

      // Nothing recorded here on purpose - the badge is derived by
      // prSetMarkersFor from the sets as they stand.
      void isPr;
    },
    [historicalBests, historicalHolds, isAssistedById, isHold, weightUnit],
  );

  return { prSetMarkersFor, checkForPRs };
}
