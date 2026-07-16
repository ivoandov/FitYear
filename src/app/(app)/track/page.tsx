"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DesktopTopBar } from "@/components/DesktopTopBar";
import { Input } from "@/components/ui/input";
import { RestTimer } from "@/components/RestTimer";
import { SetRow } from "@/components/track/SetRow";
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
import { ChevronRight, ChevronLeft, Check, Plus, Play, Dumbbell, Sparkles } from "lucide-react";
import { useWorkout, type TrackingProgress } from "@/context/WorkoutContext";
import { useSettings } from "@/components/SettingsProvider";
import { useQuery } from "@tanstack/react-query";
import type { Exercise } from "@/lib/db/schema";
import { useExerciseDetails } from "@/hooks/useExerciseDetails";
import { convertWeight, lbsToDisplay, displayToLbs } from "@/lib/units";
import { type SetData } from "@/lib/workout-stats";
import {
  getLastRecordedValues as getLastRecordedValuesHelper,
  getDefaultSets as getDefaultSetsHelper,
} from "@/lib/track-helpers";
import { overloadSuggestion } from "@/lib/analytics";
import { usePrDetection } from "@/hooks/use-pr-detection";
import { toast } from "@/hooks/use-toast";

type TrackingState = "not_started" | "in_set" | "resting";

const TRACKING_STORAGE_KEY = "workout_tracking_progress";

// The one tall neon primary-CTA treatment of the A+ refresh (mirrors the fit-bot
// workout page's CTA): brand gradient + strong glow, 56px touch target.
const CTA =
  "flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-primary-foreground font-bold text-base shadow-cta-strong disabled:opacity-60";

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
  
  // `settingsPending` is true only until the query settles (data OR error), so
  // the restore effect can wait for the real unit instead of racing the 'lbs'
  // default. On error it settles with no data -> we fall back to 'lbs' rather
  // than deadlocking the tracker.
  const { data: userSettingsData, isPending: settingsPending } = useQuery<{ weightUnit?: string }>({ queryKey: ['/api/user-settings'] });
  const weightUnit = (userSettingsData?.weightUnit ?? 'lbs') as 'lbs' | 'kg';

  // Conversion helpers — DB always stores lbs; display in user's chosen unit.
  // Both route through the shared lib/units convention (round to 1 decimal).
  const fromLbs = (lbs: number | null): number | null => lbsToDisplay(lbs, weightUnit);
  const toLbs = (val: number | null): number | null => displayToLbs(val, weightUnit);
  // Increment for +/- buttons: 2.5 lbs or 2.5 kg
  const weightIncrement = 2.5;

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

  // In-workout PR detection (historical bests + toasts + persistent markers)
  // lives in usePrDetection; TrackPage just wires it up and reads prSetMarkers.
  const { prSetMarkers, checkForPRs } = usePrDetection(
    completedWorkouts,
    exercises,
    weightUnit,
  );

  // The unit the in-memory weights are currently expressed in. Single source of
  // truth for conversions: the restore effect seeds it, the live effect below
  // reads/updates it. Seeded lazily (not from the possibly-default weightUnit)
  // because only the restore effect, gated on settings, may set it first.
  const weightsUnitRef = useRef<'lbs' | 'kg'>(weightUnit);

  // Restore saved progress once, AFTER the unit preference has settled.
  // Gating on `settingsPending` closes a race: if restore ran at the default
  // 'lbs' before settings resolved, a late 'kg' resolve would double-convert
  // (restore treats the numbers as lbs, then the live effect flips lbs->kg)
  // and drift the values. Waiting for the real unit means we convert exactly
  // once, from the saved unit to the current unit.
  useEffect(() => {
    if (!activeWorkout || hasLoadedSavedProgress || settingsPending) return;
    if (trackingProgress && trackingProgress.workoutDisplayId === activeWorkout.displayId) {
      // Saved weights are in trackingProgress.weightUnit; convert to the current
      // unit so inputs match their labels. Pre-2026-06 saves lack a unit and are
      // treated as the current unit (no conversion).
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
    // The in-memory weights are now expressed in the current display unit.
    weightsUnitRef.current = weightUnit;
    setHasLoadedSavedProgress(true);
  }, [activeWorkout, trackingProgress, hasLoadedSavedProgress, weightUnit, settingsPending]);

  // Seed the rest timer from the first FitBot exercise's authored rest when
  // starting fresh (no saved progress to restore). Normal workouts and resumed
  // sessions keep their existing rest duration.
  useEffect(() => {
    if (!hasLoadedSavedProgress || trackingProgress) return;
    const firstRest = (activeWorkout?.exercises?.[0] as any)?.plannedRest;
    if (typeof firstRest === "number" && firstRest > 0) setRestTimerDuration(firstRest);
    // Seed once, right after the initial load settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedSavedProgress]);

  // Live re-conversion: if the user switches units in Settings WHILE a workout
  // is in progress, every in-memory weight flips to the new unit so the
  // displayed number and its label stay consistent. Without this, a "60"
  // entered in lbs would still read "60" after switching to kg (now mislabelled)
  // and could be saved as 60 lbs from a value meant to be 27. Only reacts to a
  // user-initiated change after load (weightsUnitRef is seeded by restore).
  useEffect(() => {
    if (!hasLoadedSavedProgress) return;
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

  // Thin wrappers over the tested helpers in lib/track-helpers, closing over
  // the current completed workouts + display unit.
  const getLastRecordedValues = (exerciseId: string) =>
    getLastRecordedValuesHelper(completedWorkouts, exerciseId);

  // A FitBot single-workout exercise carries plannedSets/plannedReps; a routine
  // day carries plannedLoadLbs (the deterministic per-week target). Normal
  // exercises carry neither, so they keep the historic 1-or-3 default (no plan
  // passed). Row count still follows plannedSets only — a routine's target load
  // prefills weight without changing set-count behavior for scheduled/template
  // workouts (recorded history always wins on row 0 either way).
  const planOf = (ex: any) =>
    ex?.plannedSets != null || ex?.plannedLoadLbs != null
      ? { sets: ex.plannedSets, reps: ex.plannedReps, targetLoadLbs: ex.plannedLoadLbs }
      : undefined;

  const getDefaultSets = (exerciseId?: string, exerciseType?: string, plan?: { sets?: number; reps?: number | null; targetLoadLbs?: number | null }): SetData[] =>
    getDefaultSetsHelper(completedWorkouts, weightUnit, exerciseId, exerciseType, plan);

  const getCurrentSets = (): SetData[] => {
    const currentExercise = enrichedWorkoutExercises[currentExerciseIndex] as any;
    if (!currentExercise) return getDefaultSets();
    const instanceId = currentExercise.instanceId;
    return exerciseSets.get(instanceId) || getDefaultSets(currentExercise.id, currentExercise.exerciseType, planOf(currentExercise));
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
          newMap.set(currentEx.instanceId, getDefaultSets(currentEx.id, currentEx.exerciseType, planOf(currentEx)));
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
        <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold mb-4" data-testid="text-no-workout">No Active Workout</h1>
            <p className="text-muted-foreground mb-6">
              Start a workout from the Workouts page, or let FitBot build one for you.
            </p>
            <Button onClick={() => router.push("/")} data-testid="button-go-to-workouts">
              Go to Workouts
            </Button>
            {/* FitBot single-workout entry from the empty Track state. */}
            <button
              type="button"
              onClick={() => router.push("/fit-bot/workout")}
              className="mx-auto mt-4 flex w-full max-w-sm items-center gap-3 h-[52px] rounded-2xl border-[1.5px] border-yellow bg-primary-dim px-4 text-left"
              data-testid="button-fitbot-entry-track"
            >
              <Sparkles className="h-[18px] w-[18px] shrink-0 text-primary" />
              <span className="flex-1 text-sm text-muted-foreground">Describe your workout…</span>
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-tertiary-foreground" />
            </button>
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

  // Progressive-overload ghost target for the current weight/reps exercise,
  // derived from the last recorded session's top set (the same source that
  // prefills row 0). Rendered as a subtle mono hint under the weight pill and
  // cleared the moment the prefilled row is edited (Design review 2026-07-13: a
  // set-row hint, never a card that shifts the grid). Needs prior history, so a
  // first-ever session shows nothing. Note: getLastRecordedValues picks the
  // heaviest set, which for an assisted lift is the easiest one - the same
  // wrinkle the exercise-page overload card has, kept consistent on purpose.
  const overloadGhost = (() => {
    const ex = currentExercise as any;
    if (!ex || ex.exerciseType === "distance_time") return null;
    const last = getLastRecordedValues(ex.id);
    if (!last || last.weight == null || last.reps == null) return null;
    const s = overloadSuggestion({
      lastTopWeightLbs: last.weight,
      lastReps: last.reps,
      isAssisted: !!ex.isAssisted,
    });
    const assist = ex.isAssisted ? " assist" : "";
    return {
      prefillWeight: fromLbs(last.weight),
      prefillReps: last.reps,
      text: `target ${fromLbs(s.suggestedWeightLbs)}${assist} × ${s.suggestedReps}`,
    };
  })();

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

  // Unified set-complete handler for both exercise types (was two near-identical
  // inline checkbox handlers). Distance/time sets don't propagate or PR-check.
  const handleToggleSetComplete = (index: number, checked: boolean) => {
    const isDistanceTime = currentExercise?.exerciseType === "distance_time";
    let newSets = [...sets];
    newSets[index].completed = checked;
    if (checked && !isDistanceTime) {
      newSets = propagateToNextSet(newSets, index);
    }
    setCurrentSets(newSets);
    if (!checked) return;

    if (!isDistanceTime) {
      // PR check (in-workout)
      const completedSet = newSets[index];
      const wLbs = toLbs(completedSet.weight) ?? 0;
      const reps = completedSet.reps ?? 0;
      if (currentExercise && activeWorkout) {
        const ex = activeWorkout.exercises[currentExerciseIndex];
        if (ex) {
          checkForPRs(ex.id, ex.instanceId, currentExercise.name, index, wLbs, reps, exerciseSets);
        }
      }
    }
    if (restTimerOnManualComplete) {
      setTrackingState("resting");
    }
    if (index === currentSetIndex && currentSetIndex < sets.length - 1 && !restTimerOnManualComplete) {
      setCurrentSetIndex(currentSetIndex + 1);
      setTrackingState("not_started");
    }
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
            exerciseSets,
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
        toast({
          title: "Couldn't save your workout",
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
                toast({
                  title: `🎯 Day ${day} complete — Day ${day + 1} unlocked`,
                  description: ri.routineName,
                });
              } else {
                toast({
                  title: `🏁 Routine complete: ${ri.routineName}`,
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
      toast({
        title: "Couldn't save your workout",
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
    // Relocate the current exercise by instanceId, not id. The whole tracking
    // subsystem (exerciseSets, PR markers) is keyed on instanceId; a findIndex
    // by id lands on the FIRST occurrence, so with a duplicated exercise the
    // edit jumps to the wrong instance. instanceIds are preserved through the
    // editor via updateActiveWorkout's pool.
    const currentInstanceId = (
      activeWorkout.exercises[currentExerciseIndex] as { instanceId?: string } | undefined
    )?.instanceId;
    const newExercises = data.exercises;

    updateActiveWorkout(data.name, data.exercises);
    setIsEditDialogOpen(false);

    // Reset to the last exercise if the current one fell off the end.
    if (currentExerciseIndex >= newExercises.length) {
      setCurrentExerciseIndex(Math.max(0, newExercises.length - 1));
      setCurrentSetIndex(0);
      setTrackingState("not_started");
      return;
    }

    // Find where this exact instance landed in the edited list.
    const newIndex = newExercises.findIndex(
      (ex) => (ex as { instanceId?: string }).instanceId === currentInstanceId,
    );
    if (newIndex >= 0 && newIndex !== currentExerciseIndex) {
      setCurrentExerciseIndex(newIndex);
    } else if (newIndex < 0) {
      // Current instance was removed — go to the first exercise.
      setCurrentExerciseIndex(0);
      setCurrentSetIndex(0);
      setTrackingState("not_started");
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
        <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
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
      <DesktopTopBar
        title={
          <span className="flex items-baseline gap-3">
            <span className="truncate">{activeWorkout.name}</span>
            <span className="shrink-0 font-mono text-[12px] font-normal uppercase tracking-[0.06em] text-tertiary-foreground">
              Exercise {currentExerciseIndex + 1} / {enrichedWorkoutExercises.length}
            </span>
          </span>
        }
      />
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6 md:pt-7">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary md:hidden">
            Exercise {currentExerciseIndex + 1} / {enrichedWorkoutExercises.length}
          </div>
          <h1 className="mt-1.5 text-2xl font-bold tracking-[-0.01em] md:hidden" data-testid="text-page-title">
            {activeWorkout.name}
          </h1>
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08] md:mt-0"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            data-testid="progress-workout"
          >
            <div
              className="h-full rounded-full bg-primary shadow-[0_0_10px_rgba(229,255,0,0.5)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="card-elevated p-4">
          <div className="mb-4 flex items-center gap-2.5">
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl"
              onClick={handlePreviousExercise}
              disabled={currentExerciseIndex === 0}
              aria-label="Previous exercise"
              data-testid="button-previous-exercise"
            >
              <ChevronLeft className="h-[18px] w-[18px]" />
            </Button>
            <div className="min-w-0 flex-1 text-center">
              <div className="line-clamp-2 text-balance text-[19px] font-bold leading-tight text-foreground" data-testid="text-current-exercise">
                {currentExercise.name}
              </div>
              {currentExercise.muscleGroups?.length ? (
                <div className="mt-0.5 truncate font-mono text-[11px] uppercase tracking-[0.04em] text-tertiary-foreground">
                  {currentExercise.muscleGroups.join(" · ")}
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 rounded-xl"
              onClick={handleNextExercise}
              disabled={currentExerciseIndex === enrichedWorkoutExercises.length - 1}
              aria-label="Next exercise"
              data-testid="button-next-exercise"
            >
              <ChevronRight className="h-[18px] w-[18px]" />
            </Button>
          </div>

          <div>
            <div className="space-y-1">
              {currentExercise.exerciseType === "distance_time" ? (
                <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-x-2.5 items-center border-b border-divider px-2 pb-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-tertiary-foreground">
                  <div>Set</div>
                  <div className="text-center">Distance (mi)</div>
                  <div className="text-center">Time (min)</div>
                  <div className="text-center">✓</div>
                </div>
              ) : (
                <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-x-2.5 items-center border-b border-divider px-2 pb-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-tertiary-foreground">
                  <div>Set</div>
                  <div className="text-center">Weight ({weightUnit})</div>
                  <div className="text-center">Reps</div>
                  <div className="text-center">✓</div>
                </div>
              )}
              {sets.map((set, index) => {
                const isCurrentSet = index === currentSetIndex && !set.completed;
                const isActive = isCurrentSet && trackingState === "in_set";
                const currentInstanceId = activeWorkout?.exercises[currentExerciseIndex]?.instanceId;
                const isPR = !!currentInstanceId && (prSetMarkers.get(currentInstanceId)?.has(index) ?? false);
                // Show the overload ghost only on the current set while it still
                // holds the untouched prefill (weight + reps === last session's
                // top set) - any edit clears it, with no extra state.
                const ghostTarget =
                  isCurrentSet && overloadGhost &&
                  set.weight === overloadGhost.prefillWeight &&
                  set.reps === overloadGhost.prefillReps
                    ? overloadGhost.text
                    : undefined;
                return (
                  <SetRow
                    key={set.setNumber}
                    set={set}
                    isDistanceTime={currentExercise.exerciseType === "distance_time"}
                    isCurrentSet={isCurrentSet}
                    isActive={isActive}
                    isPR={isPR}
                    weightUnit={weightUnit}
                    weightIncrement={weightIncrement}
                    showKgConversion={showKgConversion}
                    ghostTarget={ghostTarget}
                    onFieldChange={(field, value) => {
                      const newSets = [...sets];
                      newSets[index][field] = value;
                      setCurrentSets(newSets);
                    }}
                    onToggleComplete={(checked) => handleToggleSetComplete(index, checked)}
                  />
                );
              })}
              {allSetsCompleted && (
                <button
                  type="button"
                  onClick={handleAddSet}
                  data-testid="button-add-set"
                  className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-white/[0.03] text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.06]"
                >
                  <Plus className="h-4 w-4" />
                  Add Set
                </button>
              )}
            </div>

            {/* Rest control pill: mono REST + editable seconds + neon play */}
            <div className="mt-4 flex items-center gap-2.5 rounded-xl border bg-card px-3.5 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-tertiary-foreground">
                Rest
              </span>
              <div className="ml-auto flex items-baseline font-mono text-base font-semibold text-foreground">
                <Input
                  type="number"
                  value={restTimerDuration}
                  onChange={(e) => setRestTimerDuration(parseInt(e.target.value) || 90)}
                  aria-label="Rest duration in seconds"
                  data-testid="input-rest-timer"
                  className="h-auto w-11 rounded-none border-0 bg-transparent p-0 text-right font-mono text-base font-semibold text-foreground focus-visible:border-0 focus-visible:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span>s</span>
              </div>
              <button
                type="button"
                onClick={() => setTrackingState("resting")}
                aria-label="Start rest timer"
                data-testid="button-start-rest-timer"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.12] text-primary transition-colors hover:bg-primary/20"
              >
                <Play className="size-3.5 fill-current" />
              </button>
            </div>

            {/* Finish CTA — appears only when every set is checked; the checkbox
                completes individual sets (no separate "End Set" button). */}
            {allSetsCompleted && (
              <button
                type="button"
                onClick={handlePrimaryButtonClick}
                data-testid="button-primary-action"
                className={`${CTA} mt-4`}
              >
                <Check className="h-[18px] w-[18px]" />
                {getPrimaryButtonText()}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => setIsAddExerciseOpen(true)}
            data-testid="button-add-exercise"
            className="flex h-[46px] w-full items-center justify-center gap-2 rounded-xl border bg-white/[0.03] text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.06]"
          >
            <Plus className="h-4 w-4" />
            Add Exercise
          </button>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => { flushProgress(); setIsEditDialogOpen(true); }}
              data-testid="button-edit-workout"
              className="h-[46px] flex-1 rounded-xl border text-sm font-semibold text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleEndWorkout}
              data-testid="button-end-workout"
              className="h-[46px] flex-1 rounded-xl border text-sm font-semibold text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              End Workout
            </button>
          </div>
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