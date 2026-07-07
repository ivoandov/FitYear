"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { displayToLbs, type WeightUnit } from "@/lib/units";
import type { SetData } from "@/lib/workout-stats";

interface ExerciseLite {
  id: string;
  isAssisted?: boolean | null;
}

/**
 * In-workout PR detection engine, extracted verbatim from TrackPage.
 *
 * Builds historical bests per exercise (max weight for normal exercises, MIN
 * weight for assisted — less counterweight = harder), and `checkForPRs` fires a
 * toast + records a persistent marker when a just-completed set beats the best
 * (historical + earlier sets in the current workout). Volume PRs are skipped
 * for assisted exercises. Algorithm unchanged; only relocated.
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

  // Which (instanceId, setIndex) pairs hit a PR this workout — drives the badge.
  const [prSetMarkers, setPrSetMarkers] = useState<Map<string, Set<number>>>(new Map());

  const checkForPRs = useCallback(
    (
      exerciseId: string,
      instanceId: string,
      exerciseName: string,
      setIndex: number,
      setWeightLbs: number,
      setReps: number,
      exerciseSets: Map<string, SetData[]>,
    ) => {
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

      let isPr = false;
      const isWeightPr = assisted
        ? runningBestWeight === Number.POSITIVE_INFINITY || setWeightLbs < runningBestWeight
        : setWeightLbs > runningBestWeight;
      if (isWeightPr) {
        isPr = true;
        const prevLabel = !isFinite(runningBestWeight) || runningBestWeight === 0
          ? "—"
          : `${runningBestWeight} lbs`;
        toast(`🏆 ${exerciseName} — new weight PR!`, {
          description: assisted
            ? `${setWeightLbs} lbs assist (was ${prevLabel}) — less help = harder`
            : `${setWeightLbs} lbs (was ${prevLabel})`,
        });
      }
      // Volume PR only meaningful for non-assisted exercises
      if (!assisted && volume > runningMaxVolume) {
        isPr = true;
        toast(`⭐ ${exerciseName} — new volume PR!`, {
          description: `${setWeightLbs} × ${setReps} = ${volume} lbs (was ${runningMaxVolume || "—"})`,
        });
      }

      if (isPr) {
        setPrSetMarkers((prev) => {
          const next = new Map(prev);
          const setForInstance = new Set(next.get(instanceId) ?? []);
          setForInstance.add(setIndex);
          next.set(instanceId, setForInstance);
          return next;
        });
      }
    },
    [historicalBests, isAssistedById, weightUnit],
  );

  return { prSetMarkers, checkForPRs };
}
