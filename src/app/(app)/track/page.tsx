"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RestTimer } from "@/components/RestTimer";
import { useTimer } from "@/context/TimerContext";
import { WorkoutEditorDialog, WorkoutData } from "@/components/WorkoutEditorDialog";
import { AddExercisesSheet, type PickerExercise } from "@/components/AddExercisesSheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronRight, ChevronLeft, Check, Plus, Pencil, Play, Trophy, Dumbbell } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useWorkout, type TrackingProgress } from "@/context/WorkoutContext";
import { useSettings } from "@/components/SettingsProvider";
import { useQuery } from "@tanstack/react-query";
import type { Exercise } from "@/lib/db/schema";
import { useExerciseDetails } from "@/hooks/useExerciseDetails";
import { convertWeight, lbsToDisplay, displayToLbs, LB_PER_KG } from "@/lib/units";
import { type SetData } from "@/lib/workout-stats";
import { toast } from "sonner";

type TrackingState = "not_started" | "in_set" | "resting";

const TRACKING_STORAGE_KEY = "workout_tracking_progress";

export default function TrackPage() {
  const router = useRouter();
  const {
    activeWorkout,
    completeWorkout,
    updateActiveWorkout,
    discardActiveWorkout,
    completedWorkouts,
    trackingProgress,
    saveTrackingProgress,
    clearTrackingProgress,
    flushProgress,
  } = useWorkout();
  const { restTimerOnManualComplete, showKgConversion } = useSettings();
  
  const { data: userSettingsData } = useQuery<{ weightUnit?: string }>({ queryKey: ['/api/user-settings'] });
  const weightUnit = (userSettingsData?.weightUnit ?? 'lbs') as 'lbs' | 'kg';

  // Conversion helpers — DB always stores lbs; display in user's chosen unit.
  // Both route through the shared lib/units convention (round to 1 decimal).
  const fromLbs = (lbs: number | null): number | null => lbsToDisplay(lbs, weightUnit);
  const toLbs = (val: number | null): number | null => displayToLbs(val, weightUnit);
  // Increment for +/- buttons: 5 lbs or 2.5 kg
  const weightIncrement = weightUnit === 'kg' ? 2.5 : 5;

  const [currentExerciseIndex, setCurrentExerciseIndex] = useState(0);
  const [trackingState, setTrackingState] = useState<TrackingState>("not_started");
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [restTimerDuration, setRestTimerDuration] = useState(90);
  const [exerciseSets, setExerciseSets] = useState<Map<string, SetData[]>>(new Map()); // Keyed by exercise instanceId for stability
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAddExerciseOpen, setIsAddExerciseOpen] = useState(false);
  // Discard-confirm for finishing a workout with zero logged sets (junk guard).
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [hasLoadedSavedProgress, setHasLoadedSavedProgress] = useState(false);
  // Tracks which (instanceId, setIndex) pairs hit a PR during this workout — used
  // to render the persistent neon "PR" badge on those rows.
  const [prSetMarkers, setPrSetMarkers] = useState<Map<string, Set<number>>>(new Map());
  const restCloseProcessed = useRef(false);

  const { data: exercises = [] } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });

  const { enrichExercises } = useExerciseDetails();

  const enrichedWorkoutExercises = useMemo(() => {
    if (!activeWorkout?.exercises) return [];
    return enrichExercises(activeWorkout.exercises as any[]);
  }, [activeWorkout?.exercises, enrichExercises]);

  // Library exercises shaped for the Add Exercise picker (mid-workout add).
  const pickerExercises = useMemo<PickerExercise[]>(
    () =>
      exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        muscleGroups: (ex.muscleGroups || []) as string[],
        description: ex.description ?? undefined,
        imageUrl: ex.imageUrl ?? undefined,
        exerciseType: ex.exerciseType as "weight_reps" | "distance_time" | undefined,
        isAssisted: ex.isAssisted ?? undefined,
      })),
    [exercises],
  );

  // isAssisted lookup — assisted exercises (e.g. assisted pull-up machine)
  // INVERT weight PR direction: lower counterweight = harder = PR.
  const isAssistedById = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const ex of exercises) m.set(ex.id, !!ex.isAssisted);
    return m;
  }, [exercises]);

  // Historical bests per exerciseId (in lbs/db units) — used for in-workout PR detection.
  // For normal exercises: best = maximum weight; for assisted: best = minimum weight.
  // Volume PR only tracked for non-assisted (weight*reps is meaningless when "weight"
  // is a counter-assist).
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
   * Called when a set is marked complete. Compares the set vs historical bests
   * (and any earlier set in THIS workout for the same exercise) and fires PR
   * toasts when applicable. Updates `prSetMarkers` so the row keeps a neon
   * border + PR badge for the rest of the workout.
   */
  const checkForPRs = (
    exerciseId: string,
    instanceId: string,
    exerciseName: string,
    setIndex: number,
    setWeightLbs: number,
    setReps: number,
  ) => {
    if (setWeightLbs <= 0 || setReps <= 0) return;
    const assisted = isAssistedById.get(exerciseId) === true;
    const volume = setWeightLbs * setReps;
    const hist = historicalBests.get(exerciseId);

    // Running best across earlier sets in THIS workout for the same instance.
    // For normal exercises track max; for assisted track min (over non-zero weights).
    let runningBestWeight = hist?.bestWeight ?? (assisted ? Number.POSITIVE_INFINITY : 0);
    let runningMaxVolume = hist?.maxVolume ?? 0;
    const earlierSets = (exerciseSets.get(instanceId) ?? []).slice(0, setIndex);
    for (const s of earlierSets) {
      if (!s.completed) continue;
      const wLbs = toLbs(s.weight) ?? 0;
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
  };

  // Load saved progress from context on mount
  useEffect(() => {
    if (activeWorkout && !hasLoadedSavedProgress) {
      if (trackingProgress && trackingProgress.workoutDisplayId === activeWorkout.displayId) {
        console.log("Restoring tracking progress from server");
        // If the user switched units in Settings between sessions, the saved
        // weights are in the previous display unit. Convert each weight to
        // the current unit so the inputs match the labels they sit under.
        // Pre-2026-06 saves don't carry a unit; we assume current unit (no
        // conversion) — same behavior as before this fix for that case.
        const savedUnit = (trackingProgress.weightUnit ?? weightUnit) as 'lbs' | 'kg';
        const restoredMap = new Map<string, SetData[]>();
        for (const [instanceId, sets] of trackingProgress.exerciseSets) {
          const converted = savedUnit === weightUnit
            ? sets
            : sets.map(s => ({ ...s, weight: convertWeight(s.weight, savedUnit, weightUnit) }));
          restoredMap.set(instanceId, converted);
        }
        setExerciseSets(restoredMap);
        setCurrentExerciseIndex(trackingProgress.currentExerciseIndex);
        setCurrentSetIndex(trackingProgress.currentSetIndex);
        setRestTimerDuration(trackingProgress.restTimerDuration);
      }
      setHasLoadedSavedProgress(true);
    }
  }, [activeWorkout, trackingProgress, hasLoadedSavedProgress, weightUnit]);

  // Live re-conversion: if the user switches units in Settings WHILE a workout
  // is in progress, every in-memory weight needs to flip to the new unit so
  // the displayed number and the unit label stay consistent. Without this,
  // a "60" entered while in lbs would still read "60" after switching to kg
  // (now mislabelled) and could be saved as 60 lbs from a value meant to be 27.
  const weightsUnitRef = useRef<'lbs' | 'kg'>(weightUnit);
  useEffect(() => {
    if (!hasLoadedSavedProgress) {
      weightsUnitRef.current = weightUnit;
      return;
    }
    const from = weightsUnitRef.current;
    if (from === weightUnit) return;
    weightsUnitRef.current = weightUnit;
    setExerciseSets(prev => {
      if (prev.size === 0) return prev;
      const next = new Map<string, SetData[]>();
      prev.forEach((sets, key) => {
        next.set(key, sets.map(s => ({ ...s, weight: convertWeight(s.weight, from, weightUnit) })));
      });
      return next;
    });
  }, [weightUnit, hasLoadedSavedProgress]);

  // Auto-save progress to context whenever tracking state changes
  useEffect(() => {
    if (activeWorkout && hasLoadedSavedProgress && exerciseSets.size > 0) {
      const progress: TrackingProgress = {
        workoutDisplayId: activeWorkout.displayId,
        exerciseSets: Array.from(exerciseSets.entries()),
        currentExerciseIndex,
        currentSetIndex,
        restTimerDuration,
        weightUnit, // Persist so the next load can re-convert if Settings changed in between
      };
      saveTrackingProgress(progress);
    }
  }, [activeWorkout, exerciseSets, currentExerciseIndex, currentSetIndex, restTimerDuration, hasLoadedSavedProgress, saveTrackingProgress, weightUnit]);

  // Flush progress when navigating away from the page; also minimize timer so pill persists
  useEffect(() => {
    return () => {
      if (activeWorkout) {
        console.log("[TrackPage] Unmounting - flushing progress");
        flushProgress();
      }
      // Auto-minimize so the pill stays visible on other tabs
      setTimerMinimized(true);
    };
  }, [activeWorkout, flushProgress]);

  // Clear saved progress when workout ends
  const clearSavedProgress = () => {
    clearTrackingProgress();
  };

  // Find the best set (highest weight) for an exercise from the most recent workout that contained it
  const getLastRecordedValues = (exerciseId: string): { weight: number; reps: number; distance: number; time: number } | null => {
    // Sort completed workouts by date descending to get most recent first
    const sortedWorkouts = [...completedWorkouts].sort((a, b) => 
      b.completedAt.getTime() - a.completedAt.getTime()
    );
    
    for (const workout of sortedWorkouts) {
      const exercise = workout.exercises.find(ex => ex.id === exerciseId) as any;
      if (exercise?.setsData && exercise.setsData.length > 0) {
        const completedSets = exercise.setsData.filter((s: any) => s.completed);
        if (completedSets.length > 0) {
          // For weight/reps exercises, show the set with the highest weight
          // For distance/time exercises, show the set with the longest distance
          const bestSet = completedSets.reduce((best: any, s: any) => {
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
      }
    }
    return null;
  };

  const getDefaultSets = (exerciseId?: string, exerciseType?: string): SetData[] => {
    const lastValues = exerciseId ? getLastRecordedValues(exerciseId) : null;
    
    // Distance/time exercises default to 1 set, weight/reps default to 3 sets
    const isDistanceTime = exerciseType === "distance_time";
    
    if (lastValues) {
      const displayWeight = fromLbs(lastValues.weight);
      if (isDistanceTime) {
        return [
          { setNumber: 1, weight: displayWeight, reps: lastValues.reps, distance: lastValues.distance, time: lastValues.time, completed: false },
        ];
      }
      return [
        { setNumber: 1, weight: displayWeight, reps: lastValues.reps, distance: lastValues.distance, time: lastValues.time, completed: false },
        { setNumber: 2, weight: null, reps: null, distance: null, time: null, completed: false },
        { setNumber: 3, weight: null, reps: null, distance: null, time: null, completed: false },
      ];
    }
    
    if (isDistanceTime) {
      return [
        { setNumber: 1, weight: null, reps: null, distance: null, time: null, completed: false },
      ];
    }
    return [
      { setNumber: 1, weight: null, reps: null, distance: null, time: null, completed: false },
      { setNumber: 2, weight: null, reps: null, distance: null, time: null, completed: false },
      { setNumber: 3, weight: null, reps: null, distance: null, time: null, completed: false },
    ];
  };

  const getCurrentSets = (): SetData[] => {
    const currentExercise = enrichedWorkoutExercises[currentExerciseIndex] as any;
    if (!currentExercise) return getDefaultSets();
    const instanceId = currentExercise.instanceId;
    return exerciseSets.get(instanceId) || getDefaultSets(currentExercise.id, currentExercise.exerciseType);
  };

  const setCurrentSets = (sets: SetData[]) => {
    const currentExercise = enrichedWorkoutExercises[currentExerciseIndex] as any;
    if (!currentExercise?.instanceId) return;
    const newMap = new Map(exerciseSets);
    newMap.set(currentExercise.instanceId, sets);
    setExerciseSets(newMap);
  };

  useEffect(() => {
    if (!hasLoadedSavedProgress) return;
    if (enrichedWorkoutExercises.length > 0) {
      const currentEx = enrichedWorkoutExercises[currentExerciseIndex] as any;
      if (currentEx?.instanceId) {
        setExerciseSets(prev => {
          if (prev.has(currentEx.instanceId)) return prev;
          const newMap = new Map(prev);
          newMap.set(currentEx.instanceId, getDefaultSets(currentEx.id, currentEx.exerciseType));
          return newMap;
        });
      }
    }
  }, [currentExerciseIndex, enrichedWorkoutExercises, hasLoadedSavedProgress]);

  useEffect(() => {
    if (!hasLoadedSavedProgress || !userSettingsData || completedWorkouts.length === 0 || enrichedWorkoutExercises.length === 0) return;
    if (trackingProgress) return;
    setExerciseSets(prev => {
      let changed = false;
      const newMap = new Map(prev);
      for (const ex of enrichedWorkoutExercises as any[]) {
        if (!ex?.instanceId) continue;
        const sets = newMap.get(ex.instanceId);
        if (!sets || sets.length === 0) continue;
        const firstSet = sets[0];
        if (firstSet.completed) continue;
        if (firstSet.weight != null || firstSet.reps != null || firstSet.distance != null || firstSet.time != null) continue;
        const lastValues = getLastRecordedValues(ex.id);
        if (lastValues) {
          const updatedSets = [...sets];
          updatedSets[0] = { ...firstSet, weight: fromLbs(lastValues.weight), reps: lastValues.reps, distance: lastValues.distance, time: lastValues.time };
          newMap.set(ex.instanceId, updatedSets);
          changed = true;
        }
      }
      return changed ? newMap : prev;
    });
  }, [completedWorkouts, enrichedWorkoutExercises, hasLoadedSavedProgress, userSettingsData]);

  const { openTimer, isOpen: timerIsOpen, setIsMinimized: setTimerMinimized } = useTimer();
  const handleRestTimerCloseRef = useRef<() => void>(() => {});

  // Open the timer in TimerContext whenever we enter resting state
  useEffect(() => {
    if (trackingState === "resting") {
      restCloseProcessed.current = false;
      const exAtIndex = enrichedWorkoutExercises[currentExerciseIndex] as any;
      const nextEx = enrichedWorkoutExercises[currentExerciseIndex + 1] as any;
      openTimer({
        initialSeconds: restTimerDuration,
        exerciseName: exAtIndex?.name ?? "Rest",
        nextExerciseName: nextEx?.name,
        onClose: () => handleRestTimerCloseRef.current(),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingState]);

  // When navigating back to TrackPage while timer is still running, restore resting state
  useEffect(() => {
    if (timerIsOpen && hasLoadedSavedProgress && trackingState !== "resting") {
      setTrackingState("resting");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerIsOpen, hasLoadedSavedProgress]);

  if (!activeWorkout) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold mb-4" data-testid="text-no-workout">No Active Workout</h1>
            <p className="text-muted-foreground mb-6">
              Start a workout from the Workouts page to begin tracking.
            </p>
            <Button onClick={() => router.push("/")} data-testid="button-go-to-workouts">
              Go to Workouts
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const currentExercise = enrichedWorkoutExercises[currentExerciseIndex];
  const sets = getCurrentSets();
  const progress = ((currentExerciseIndex + 1) / enrichedWorkoutExercises.length) * 100;
  const allSetsCompleted = sets.every(s => s.completed);
  const isLastExercise = currentExerciseIndex === enrichedWorkoutExercises.length - 1;

  // Copy weight+reps from a completed set into the next uncompleted set (if still empty)
  const propagateToNextSet = (setsArr: SetData[], completedIndex: number): SetData[] => {
    const next = setsArr[completedIndex + 1];
    if (!next) return setsArr;
    const current = setsArr[completedIndex];
    const updated = [...setsArr];
    updated[completedIndex + 1] = {
      ...next,
      weight: next.weight ?? current.weight,
      reps: next.reps ?? current.reps,
    };
    return updated;
  };

  const handlePrimaryAction = () => {
    if (trackingState === "not_started") {
      setTrackingState("in_set");
    } else if (trackingState === "in_set") {
      let newSets = [...sets];
      newSets[currentSetIndex].completed = true;
      newSets = propagateToNextSet(newSets, currentSetIndex);
      setCurrentSets(newSets);

      // PR check (in-workout)
      const completedSet = newSets[currentSetIndex];
      const wLbs = toLbs(completedSet.weight) ?? 0;
      const reps = completedSet.reps ?? 0;
      if (currentExercise && activeWorkout) {
        const ex = activeWorkout.exercises[currentExerciseIndex];
        if (ex) {
          checkForPRs(
            ex.id,
            ex.instanceId,
            currentExercise.name,
            currentSetIndex,
            wLbs,
            reps,
          );
        }
      }

      if (currentSetIndex < sets.length - 1) {
        setTrackingState("resting");
      } else {
        setTrackingState("not_started");
      }
    }
  };

  // Convert all weights in the exerciseSets map from display unit back to lbs before saving
  const toLbsMap = (map: Map<string, SetData[]>): Map<string, SetData[]> => {
    if (weightUnit === 'lbs') return map;
    const converted = new Map<string, SetData[]>();
    map.forEach((sets, key) => {
      converted.set(key, sets.map(s => ({ ...s, weight: toLbs(s.weight) })));
    });
    return converted;
  };

  // True if any set in the whole in-memory workout has been marked complete.
  // Guards the "End Workout with nothing logged" case so we never save a junk
  // history row (which would fabricate progress and consume a scheduled slot).
  const hasAnyCompletedSet = () =>
    [...exerciseSets.values()].some((s) => s.some((set) => set.completed));

  const handleFinishExercise = async () => {
    if (isLastExercise) {
      // Nothing logged -> offer to discard instead of saving a junk workout.
      if (!hasAnyCompletedSet()) {
        setShowDiscardConfirm(true);
        return;
      }
      const wasRoutineWorkout = !!activeWorkout?.scheduledWorkoutId;
      const newId = await completeWorkout(toLbsMap(exerciseSets));
      // Save failed (completeWorkout returns null). The active workout + entered
      // sets are preserved in state/localStorage, so DON'T navigate away and
      // DON'T pretend it saved — tell the user and let them tap Finish again.
      if (!newId) {
        toast("Couldn't save your workout", {
          description:
            "Something went wrong saving. Your progress is kept — check your connection and tap Finish again.",
        });
        return;
      }
      // Routine completion toast: if this was a routine workout, fetch the
      // updated active routine instance to show "Day N complete — Day N+1 unlocked".
      if (newId && wasRoutineWorkout) {
        try {
          const res = await fetch("/api/routine-instances/active", {
            credentials: "include",
          });
          if (res.ok) {
            const instances = (await res.json()) as Array<{ completedWorkouts: number; totalWorkouts: number; routineName: string }>;
            const ri = instances[0];
            if (ri) {
              const day = ri.completedWorkouts;
              if (day < ri.totalWorkouts) {
                toast(`🎯 Day ${day} complete — Day ${day + 1} unlocked`, {
                  description: ri.routineName,
                });
              } else {
                toast(`🏁 Routine complete: ${ri.routineName}`, {
                  description: `${ri.totalWorkouts} workouts done`,
                });
              }
            }
          }
        } catch {
          // Ignore — toast is non-essential
        }
      }
      router.push(`/workout-complete/${newId}`);
    } else {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
      setCurrentSetIndex(0);
      setTrackingState("not_started");
    }
  };

  const handleAddSet = () => {
    const newSetNumber = sets.length + 1;
    const lastSet = sets[sets.length - 1];
    const newSet: SetData = {
      setNumber: newSetNumber,
      weight: lastSet?.weight ?? null,
      reps: lastSet?.reps ?? null,
      distance: lastSet?.distance ?? null,
      time: lastSet?.time ?? null,
      completed: false,
    };
    setCurrentSets([...sets, newSet]);
    setCurrentSetIndex(sets.length);
    setTrackingState("not_started");
  };

  const handleRestTimerClose = () => {
    if (restCloseProcessed.current) return;
    restCloseProcessed.current = true;
    setTrackingState("in_set");
    if (currentSetIndex < sets.length - 1) {
      setCurrentSetIndex(currentSetIndex + 1);
    }
  };
  // Keep ref always pointing to the latest closure so TimerContext's onClose stays current
  handleRestTimerCloseRef.current = handleRestTimerClose;

  const handleNextExercise = () => {
    if (currentExerciseIndex < enrichedWorkoutExercises.length - 1) {
      setCurrentExerciseIndex(currentExerciseIndex + 1);
      setCurrentSetIndex(0);
      setTrackingState("not_started");
    }
  };

  const handlePreviousExercise = () => {
    if (currentExerciseIndex > 0) {
      setCurrentExerciseIndex(currentExerciseIndex - 1);
      setCurrentSetIndex(0);
      setTrackingState("not_started");
    }
  };

  const handleEndWorkout = async () => {
    // Nothing logged -> confirm discard rather than persisting an empty record.
    if (!hasAnyCompletedSet()) {
      setShowDiscardConfirm(true);
      return;
    }
    const newId = await completeWorkout(toLbsMap(exerciseSets));
    if (!newId) {
      toast("Couldn't save your workout", {
        description:
          "Something went wrong saving. Your progress is kept — check your connection and try again.",
      });
      return;
    }
    router.push(`/workout-complete/${newId}`);
  };

  // Append exercises picked mid-workout to the live workout. updateActiveWorkout
  // preserves instanceIds (and tracked sets) for existing exercises and assigns
  // fresh ones to the additions, then we jump to the first newly added exercise.
  const handleAddExercises = (picked: PickerExercise[]) => {
    if (!activeWorkout || picked.length === 0) return;
    const firstNewIndex = activeWorkout.exercises.length;
    const merged = [...(activeWorkout.exercises as any[]), ...picked];
    updateActiveWorkout(activeWorkout.name, merged as any);
    setIsAddExerciseOpen(false);
    setCurrentExerciseIndex(firstNewIndex);
    setCurrentSetIndex(0);
    setTrackingState("not_started");
  };

  const handleEditSave = (data: WorkoutData) => {
    // Since exerciseSets is now keyed by exercise ID, no remapping needed!
    // Set data stays aligned automatically when exercises are reordered/added/removed
    const oldExercises = activeWorkout.exercises;
    const newExercises = data.exercises;
    
    updateActiveWorkout(data.name, data.exercises);
    setIsEditDialogOpen(false);
    
    // Reset to first exercise if current exercise was removed
    if (currentExerciseIndex >= newExercises.length) {
      setCurrentExerciseIndex(Math.max(0, newExercises.length - 1));
      setCurrentSetIndex(0);
      setTrackingState("not_started");
    } else {
      // Check if current exercise still exists (might be at a different index now)
      const currentExId = oldExercises[currentExerciseIndex]?.id;
      const newIndex = newExercises.findIndex(ex => ex.id === currentExId);
      if (newIndex >= 0 && newIndex !== currentExerciseIndex) {
        // Move to the new index of the same exercise
        setCurrentExerciseIndex(newIndex);
      } else if (newIndex < 0) {
        // Current exercise was removed, go to first exercise
        setCurrentExerciseIndex(0);
        setCurrentSetIndex(0);
        setTrackingState("not_started");
      }
    }
  };

  const getPrimaryButtonText = () => {
    if (allSetsCompleted) {
      return isLastExercise ? "Finish Workout" : "Finish Exercise";
    }
    if (trackingState === "not_started") {
      return currentSetIndex === 0 ? "Start" : `Start Set ${currentSetIndex + 1}`;
    }
    if (trackingState === "in_set") {
      return "End Set";
    }
    return "Start";
  };

  const handlePrimaryButtonClick = () => {
    if (allSetsCompleted) {
      handleFinishExercise();
    } else {
      handlePrimaryAction();
    }
  };

  // Empty workout (quick-start with nothing added yet, or all exercises
  // removed): show an add-first state. Rendering the normal card here would
  // crash on the undefined current exercise.
  if (enrichedWorkoutExercises.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">
              {activeWorkout.name?.trim() || "New Workout"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Add your first exercise to start tracking
            </p>
          </div>

          <Card>
            <CardContent className="flex flex-col items-center text-center gap-4 py-12 px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-dim">
                <Dumbbell className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold">No exercises yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Pick exercises as you go — you don&apos;t have to plan ahead.
                </p>
              </div>
              <Button onClick={() => setIsAddExerciseOpen(true)} data-testid="button-add-first-exercise">
                <Plus className="h-4 w-4 mr-2" />
                Add Exercise
              </Button>
            </CardContent>
          </Card>

          <Button
            variant="outline"
            className="w-full text-sm"
            onClick={() => { discardActiveWorkout(); router.push("/"); }}
            data-testid="button-discard-empty-workout"
          >
            End Workout
          </Button>
        </div>

        <AddExercisesSheet
          isOpen={isAddExerciseOpen}
          onClose={() => setIsAddExerciseOpen(false)}
          exercises={pickerExercises}
          existingIds={[]}
          onAdd={handleAddExercises}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">
            {activeWorkout.name}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground mt-1">
            Exercise {currentExerciseIndex + 1} of {enrichedWorkoutExercises.length}
          </p>
          <Progress value={progress} className="mt-3 sm:mt-4" data-testid="progress-workout" />
        </div>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2 sm:gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={handlePreviousExercise}
                disabled={currentExerciseIndex === 0}
                data-testid="button-previous-exercise"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <div className="flex-1 text-center min-w-0">
                <CardTitle className="text-lg sm:text-2xl font-bold truncate" data-testid="text-current-exercise">
                  {currentExercise.name}
                </CardTitle>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {currentExercise.muscleGroups?.join(", ")}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNextExercise}
                disabled={currentExerciseIndex === enrichedWorkoutExercises.length - 1}
                data-testid="button-next-exercise"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
            <div className="space-y-3 sm:space-y-4">
              {currentExercise.exerciseType === "distance_time" ? (
                <>
                  <div className="grid grid-cols-4 gap-2 sm:gap-4 font-semibold text-xs sm:text-sm pb-2 border-b">
                    <div>Set</div>
                    <div className="text-center">Distance (mi)</div>
                    <div className="text-center">Time (min)</div>
                    <div className="text-center">Done</div>
                  </div>
                  {sets.map((set, index) => {
                    const isCurrentSet = index === currentSetIndex && !set.completed;
                    const isActive = isCurrentSet && trackingState === "in_set";
                    
                    return (
                      <div
                        key={set.setNumber}
                        className={`grid grid-cols-4 gap-2 sm:gap-4 items-center py-2 rounded-md px-2 border-l-2 ${
                          isActive
                            ? 'border-l-primary bg-primary-dim'
                            : isCurrentSet
                              ? 'border-l-muted-foreground/30'
                              : 'border-l-transparent'
                        }`}
                        data-testid={`row-set-${set.setNumber}`}
                      >
                        <div className="font-medium text-sm sm:text-base">{set.setNumber}</div>
                        <Input
                          type="number"
                          step="0.1"
                          value={set.distance ?? ""}
                          onChange={(e) => {
                            const newSets = [...sets];
                            newSets[index].distance = e.target.value === "" ? null : parseFloat(e.target.value);
                            setCurrentSets(newSets);
                          }}
                          className={`text-center text-sm h-9 sm:h-10 ${set.completed ? 'bg-transparent border-transparent text-muted-foreground' : ''}`}
                          data-testid={`input-distance-${set.setNumber}`}
                        />
                        <Input
                          type="number"
                          value={set.time ?? ""}
                          onChange={(e) => {
                            const newSets = [...sets];
                            newSets[index].time = e.target.value === "" ? null : parseInt(e.target.value);
                            setCurrentSets(newSets);
                          }}
                          className={`text-center text-sm h-9 sm:h-10 ${set.completed ? 'bg-transparent border-transparent text-muted-foreground' : ''}`}
                          data-testid={`input-time-${set.setNumber}`}
                        />
                        <div className="flex justify-center">
                          <Checkbox
                            checked={set.completed}
                            onCheckedChange={(checked) => {
                              const newSets = [...sets];
                              newSets[index].completed = !!checked;
                              setCurrentSets(newSets);
                              if (checked) {
                                // Start rest timer if setting is enabled
                                if (restTimerOnManualComplete) {
                                  setTrackingState("resting");
                                }
                                // If completing the current set, advance to next
                                if (index === currentSetIndex && currentSetIndex < sets.length - 1 && !restTimerOnManualComplete) {
                                  setCurrentSetIndex(currentSetIndex + 1);
                                  setTrackingState("not_started");
                                }
                              }
                            }}
                            data-testid={`checkbox-complete-${set.setNumber}`}
                            className="h-5 w-5 sm:h-6 sm:w-6"
                          />
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-[2rem_1fr_4.5rem_2.5rem] sm:grid-cols-[2.5rem_1fr_6rem_2.5rem] gap-x-2 sm:gap-x-3 items-center font-semibold text-xs sm:text-sm pb-2 border-b">
                    <div>Set</div>
                    <div className="text-center">Weight ({weightUnit})</div>
                    <div className="text-center">Reps</div>
                    <div className="text-center">Done</div>
                  </div>
                  {sets.map((set, index) => {
                    const isCurrentSet = index === currentSetIndex && !set.completed;
                    const isActive = isCurrentSet && trackingState === "in_set";
                    const currentInstanceId = activeWorkout?.exercises[currentExerciseIndex]?.instanceId;
                    const isPR = currentInstanceId
                      ? prSetMarkers.get(currentInstanceId)?.has(index) ?? false
                      : false;

                    return (
                      <div
                        key={set.setNumber}
                        className={`grid grid-cols-[2rem_1fr_4.5rem_2.5rem] sm:grid-cols-[2.5rem_1fr_6rem_2.5rem] gap-x-2 sm:gap-x-3 items-center py-2 rounded-md px-2 border-l-2 ${
                          isPR
                            ? 'border-l-primary bg-primary-dim'
                            : isActive
                              ? 'border-l-primary bg-primary-dim'
                              : isCurrentSet
                                ? 'border-l-muted-foreground/30'
                                : 'border-l-transparent'
                        }`}
                        data-testid={`row-set-${set.setNumber}`}
                      >
                        <div className="flex items-center gap-1 font-medium text-sm sm:text-base">
                          {set.setNumber}
                          {isPR ? (
                            <span className="rounded bg-primary/20 px-1 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wide">
                              PR
                            </span>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-1 sm:gap-1.5 justify-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="px-1.5 text-xs font-semibold shrink-0"
                              onClick={() => {
                                const newSets = [...sets];
                                const current = newSets[index].weight ?? 0;
                                newSets[index].weight = Math.max(0, Math.round((current - weightIncrement) * 10) / 10);
                                setCurrentSets(newSets);
                              }}
                              data-testid={`button-weight-minus-${set.setNumber}`}
                            >
                              -{weightIncrement}
                            </Button>
                            <Input
                              type="number"
                              step={weightUnit === 'kg' ? '0.5' : '1'}
                              value={set.weight ?? ""}
                              onChange={(e) => {
                                const newSets = [...sets];
                                newSets[index].weight = e.target.value === "" ? null : parseFloat(e.target.value);
                                setCurrentSets(newSets);
                              }}
                              className={`text-center text-sm h-9 sm:h-10 flex-1 min-w-0 ${set.completed ? 'bg-transparent border-transparent text-muted-foreground' : ''}`}
                              data-testid={`input-weight-${set.setNumber}`}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="px-1.5 text-xs font-semibold shrink-0"
                              onClick={() => {
                                const newSets = [...sets];
                                const current = newSets[index].weight ?? 0;
                                newSets[index].weight = Math.round((current + weightIncrement) * 10) / 10;
                                setCurrentSets(newSets);
                              }}
                              data-testid={`button-weight-plus-${set.setNumber}`}
                            >
                              +{weightIncrement}
                            </Button>
                          </div>
                          {showKgConversion && set.weight != null && weightUnit === 'lbs' && (
                            <p className="text-xs text-muted-foreground text-center tabular-nums" data-testid={`text-kg-conversion-${set.setNumber}`}>
                              {(set.weight / LB_PER_KG).toFixed(1)} kg
                            </p>
                          )}
                          {showKgConversion && set.weight != null && weightUnit === 'kg' && (
                            <p className="text-xs text-muted-foreground text-center tabular-nums" data-testid={`text-lbs-conversion-${set.setNumber}`}>
                              {(set.weight * LB_PER_KG).toFixed(0)} lbs
                            </p>
                          )}
                        </div>
                        <Input
                          type="number"
                          value={set.reps ?? ""}
                          onChange={(e) => {
                            const newSets = [...sets];
                            newSets[index].reps = e.target.value === "" ? null : parseInt(e.target.value);
                            setCurrentSets(newSets);
                          }}
                          className={`text-center text-sm h-9 sm:h-10 ${set.completed ? 'bg-transparent border-transparent text-muted-foreground' : ''}`}
                          data-testid={`input-reps-${set.setNumber}`}
                        />
                        <div className="flex justify-center">
                          <Checkbox
                            checked={set.completed}
                            onCheckedChange={(checked) => {
                              let newSets = [...sets];
                              newSets[index].completed = !!checked;
                              if (checked) {
                                newSets = propagateToNextSet(newSets, index);
                              }
                              setCurrentSets(newSets);
                              if (checked) {
                                // PR check (in-workout)
                                const completedSet = newSets[index];
                                const wLbs = toLbs(completedSet.weight) ?? 0;
                                const reps = completedSet.reps ?? 0;
                                if (currentExercise && activeWorkout) {
                                  const ex = activeWorkout.exercises[currentExerciseIndex];
                                  if (ex) {
                                    checkForPRs(
                                      ex.id,
                                      ex.instanceId,
                                      currentExercise.name,
                                      index,
                                      wLbs,
                                      reps,
                                    );
                                  }
                                }

                                if (restTimerOnManualComplete) {
                                  setTrackingState("resting");
                                }
                                if (index === currentSetIndex && currentSetIndex < sets.length - 1 && !restTimerOnManualComplete) {
                                  setCurrentSetIndex(currentSetIndex + 1);
                                  setTrackingState("not_started");
                                }
                              }
                            }}
                            data-testid={`checkbox-complete-${set.setNumber}`}
                            className="h-5 w-5 sm:h-6 sm:w-6"
                          />
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {allSetsCompleted && (
                <Button
                  variant="outline"
                  className="w-full mt-2"
                  onClick={handleAddSet}
                  data-testid="button-add-set"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Set
                </Button>
              )}
            </div>

            <div className="mt-4 sm:mt-6 space-y-3 sm:space-y-4">
              <div className="flex items-center gap-2 sm:gap-4">
                <label className="text-xs sm:text-sm font-medium whitespace-nowrap">Rest:</label>
                <Input
                  type="number"
                  value={restTimerDuration}
                  onChange={(e) => setRestTimerDuration(parseInt(e.target.value) || 90)}
                  className="w-16 sm:w-24 text-center h-9 sm:h-10"
                  data-testid="input-rest-timer"
                />
                <span className="text-xs sm:text-sm text-muted-foreground">sec</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setTrackingState("resting")}
                  data-testid="button-start-rest-timer"
                >
                  <Play className="h-4 w-4" />
                </Button>
              </div>

              <Button
                className="w-full"
                onClick={handlePrimaryButtonClick}
                data-testid="button-primary-action"
              >
                {allSetsCompleted && <Check className="h-4 w-4 mr-2" />}
                {getPrimaryButtonText()}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-2 sm:gap-3">
          <Button className="w-full text-sm" onClick={() => setIsAddExerciseOpen(true)} data-testid="button-add-exercise">
            <Plus className="h-4 w-4 mr-2" />
            Add Exercise
          </Button>
          <Button variant="outline" className="w-full text-sm" onClick={() => { flushProgress(); setIsEditDialogOpen(true); }} data-testid="button-edit-workout">
            <Pencil className="h-4 w-4 mr-2" />
            Edit Workout
          </Button>
          <Button variant="outline" className="w-full text-sm" onClick={handleEndWorkout} data-testid="button-end-workout">
            End Workout
          </Button>
        </div>

        <WorkoutEditorDialog
          isOpen={isEditDialogOpen}
          onClose={() => setIsEditDialogOpen(false)}
          onSave={handleEditSave}
          initialData={{
            id: activeWorkout.id,
            name: activeWorkout.name,
            exercises: activeWorkout.exercises,
            date: new Date(),
            repeatType: "none",
            repeatInterval: 1,
          }}
          availableExercises={exercises.map(ex => ({
            ...ex,
            muscleGroups: (ex.muscleGroups || []) as string[],
            imageUrl: ex.imageUrl ?? undefined,
            exerciseType: ex.exerciseType as "weight_reps" | "distance_time" | undefined,
          }))}
        />

        <AddExercisesSheet
          isOpen={isAddExerciseOpen}
          onClose={() => setIsAddExerciseOpen(false)}
          exercises={pickerExercises}
          existingIds={(activeWorkout.exercises as { id: string }[]).map((e) => e.id)}
          onAdd={handleAddExercises}
        />

        <AlertDialog
          open={showDiscardConfirm}
          onOpenChange={(open) => !open && setShowDiscardConfirm(false)}
        >
          <AlertDialogContent data-testid="dialog-discard-workout">
            <AlertDialogHeader>
              <AlertDialogTitle>Discard this workout?</AlertDialogTitle>
              <AlertDialogDescription>
                You haven&apos;t logged any sets. Nothing will be saved to your
                history. You can keep going and mark a set complete instead.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-discard">
                Keep going
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="button-confirm-discard"
                onClick={() => {
                  setShowDiscardConfirm(false);
                  discardActiveWorkout();
                  router.push("/");
                }}
              >
                Discard workout
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <RestTimer />
      </div>
    </div>
  );
}