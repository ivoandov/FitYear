"use client";

import { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { deriveWorkoutName, type SetData } from "@/lib/workout-stats";
import { parseServerDate, localDateKey } from "@/lib/date";
import { type Exercise } from "@/data/exercises";
import { useAuth } from "@/hooks/use-auth";

interface WorkoutExercise extends Exercise {
  instanceId: string; // Unique ID for this exercise instance in the workout (stable across edits/reorders)
  sets: number;
  defaultWeight: number;
  defaultReps: number;
  // FitBot-generated workouts carry a per-exercise prescription so the Track
  // screen opens with the right number of rows + target reps + initial rest.
  // Absent on normal (scheduled / quick-start / restart) workouts, which keep
  // the historic 1-or-3 default. See lib/track-helpers.getDefaultSets(plan).
  plannedSets?: number;
  plannedReps?: number | null;
  plannedRest?: number;
}

interface ActiveWorkout {
  id: string;
  displayId: string;
  scheduledWorkoutId: string | null;
  name: string;
  exercises: WorkoutExercise[];
  startedAt?: string; // ISO string — set on startWorkout, used for duration on complete
}

// A single exercise resolved from a FitBot generation, ready to track. `id` is
// the reconciled library/custom exercise id (see lib/workout-reconcile); the
// rest is the metadata + prescription FitBot authored. `reps` is the free-form
// prescription string ("8-12", "AMRAP", "30s") — parsed to a target integer for
// the first-row prefill.
export interface GeneratedWorkoutExercise {
  id: string;
  name: string;
  muscleGroups: string[];
  description?: string;
  imageUrl?: string | null;
  exerciseType?: string;
  isAssisted?: boolean;
  sets: number;
  reps?: string;
  rest?: number;
}

// Pull the target rep count out of a free-form prescription ("8-12" -> 8,
// "AMRAP" -> null, "15" -> 15). Used only to prefill the first row.
function parseTargetReps(reps?: string): number | null {
  if (!reps) return null;
  const m = reps.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export interface CompletedWorkoutRecord {
  id: string;
  displayId: string;
  templateId?: string | null;
  name: string;
  exercises: Exercise[];
  completedAt: Date;
  calendarEventId?: string | null;
}

// TrackingProgress is the durable snapshot of an in-progress workout (persisted
// to localStorage + the active-workout server row). Exported so TrackPage can
// build/consume the exact same shape instead of a copy-pasted duplicate.
export interface TrackingProgress {
  workoutDisplayId: string;
  exerciseSets: [string, SetData[]][]; // Keyed by exercise instanceId for stability during edits/reorders
  currentExerciseIndex: number;
  currentSetIndex: number;
  restTimerDuration: number;
  // The display unit the in-memory weights are expressed in. Set by TrackPage
  // when saving; checked by TrackPage on restore — if it differs from the
  // current user setting, weights are converted on load. Optional for
  // backwards compatibility with progress saved before this field existed
  // (those rows are treated as lbs).
  weightUnit?: 'lbs' | 'kg';
}

interface WorkoutContextType {
  activeWorkout: ActiveWorkout | null;
  completedWorkouts: CompletedWorkoutRecord[];
  isLoading: boolean;
  trackingProgress: TrackingProgress | null;
  lastCompletedWorkoutId: string | null; // Set after completeWorkout() succeeds — used by /workout-complete page
  startWorkout: (workout: { id: string; displayId: string; scheduledWorkoutId?: string; name: string; exercises: Exercise[] }) => void;
  startEmptyWorkout: () => void;
  startGeneratedWorkout: (workout: { name: string; exercises: GeneratedWorkoutExercise[] }) => void;
  discardActiveWorkout: () => void;
  completeWorkout: (exerciseSets?: Map<string, SetData[]>) => Promise<string | null>;
  isWorkoutCompleted: (displayId: string) => boolean;
  restartWorkout: (completedWorkout: CompletedWorkoutRecord) => void;
  updateCompletedWorkout: (id: string, name: string, exercises?: any[], completedAt?: Date) => Promise<boolean>;
  deleteCompletedWorkout: (id: string) => void;
  updateActiveWorkout: (name: string, exercises: Exercise[]) => void;
  saveTrackingProgress: (progress: TrackingProgress) => void;
  clearTrackingProgress: () => void;
  flushProgress: () => void;
}

const WorkoutContext = createContext<WorkoutContextType | null>(null);

const ACTIVE_WORKOUT_STORAGE_KEY = "active_workout";
const TRACKING_STORAGE_KEY = "workout_tracking_progress";

export function WorkoutProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(null);
  const [trackingProgress, setTrackingProgress] = useState<TrackingProgress | null>(null);
  const [hasLoadedFromServer, setHasLoadedFromServer] = useState(false);
  const [lastCompletedWorkoutId, setLastCompletedWorkoutId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Refs to track current state for immediate saves (visibility change, beforeunload)
  const activeWorkoutRef = useRef<ActiveWorkout | null>(null);
  const trackingProgressRef = useRef<TrackingProgress | null>(null);
  const userRef = useRef(user);
  
  // Keep refs in sync with state
  useEffect(() => {
    activeWorkoutRef.current = activeWorkout;
  }, [activeWorkout]);
  
  useEffect(() => {
    trackingProgressRef.current = trackingProgress;
  }, [trackingProgress]);
  
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Read the active workout + matching tracking progress from localStorage
  // WITHOUT touching state. localStorage is written synchronously on every
  // change, so it is the freshest copy on this device. Used for the guest path
  // and to reconcile against the server copy on load.
  const readLocal = useCallback((): {
    workout: ActiveWorkout | null;
    progress: TrackingProgress | null;
  } => {
    try {
      const saved = localStorage.getItem(ACTIVE_WORKOUT_STORAGE_KEY);
      if (!saved) return { workout: null, progress: null };
      const workout = JSON.parse(saved) as ActiveWorkout;
      let progress: TrackingProgress | null = null;
      const trackingSaved = localStorage.getItem(TRACKING_STORAGE_KEY);
      if (trackingSaved) {
        const trackingData = JSON.parse(trackingSaved);
        if (trackingData.workoutDisplayId === workout.displayId) {
          progress = trackingData;
        }
      }
      return { workout, progress };
    } catch (e) {
      console.error("[WorkoutContext] Failed to read localStorage:", e);
      return { workout: null, progress: null };
    }
  }, []);

  // Helper to load from localStorage into state (guest path / server fallback)
  const loadFromLocalStorage = useCallback(() => {
    const { workout, progress } = readLocal();
    if (workout) {
      setActiveWorkout(workout);
      if (progress) setTrackingProgress(progress);
      return true;
    }
    return false;
  }, [readLocal]);

  // Load active workout - from server for authenticated users, localStorage for guests
  useEffect(() => {
    if (hasLoadedFromServer) return;
    
    console.log("[WorkoutContext] Loading workout, user:", user ? user.id : "guest");
    
    if (user) {
      // Authenticated user: reconcile the server copy with localStorage so a
      // reload / app restart can never lose progress.
      fetch("/api/active-workout", { credentials: "include" })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          const serverWorkout = (data?.workoutData ?? null) as ActiveWorkout | null;
          const serverProgress = (data?.trackingProgress ?? null) as TrackingProgress | null;
          const { workout: localWorkout, progress: localProgress } = readLocal();

          // localStorage on this device is written synchronously on every change,
          // so for the SAME workout it is always at least as fresh as the server
          // (whose saves are debounced and can lag or fail). Prefer it whenever it
          // holds the same workout as the server, or the server has none — so a
          // lagging/failed server save can never lose the latest sets on reload.
          // Use the server only when local is empty (a fresh device/install) or
          // holds a different workout (one started on another device).
          const preferLocal =
            !!localWorkout &&
            (!serverWorkout || serverWorkout.displayId === localWorkout.displayId);

          if (preferLocal && localWorkout) {
            console.log("[WorkoutContext] Restored from localStorage (freshest copy)");
            setActiveWorkout(localWorkout);
            if (localProgress) setTrackingProgress(localProgress);
            // The save effect re-pushes this to the server, healing a stale or
            // failed server copy.
          } else if (serverWorkout) {
            console.log("[WorkoutContext] Restored from server");
            setActiveWorkout(serverWorkout);
            if (serverProgress) setTrackingProgress(serverProgress);
            // The save effect mirrors this down to localStorage.
          }
          setHasLoadedFromServer(true);
        })
        .catch(err => {
          // Server unreachable — localStorage is the source of truth.
          console.error("[WorkoutContext] active-workout load failed, using localStorage:", err);
          loadFromLocalStorage();
          setHasLoadedFromServer(true);
        });
    } else {
      // Guest user: load from localStorage only
      console.log("[WorkoutContext] Guest user, loading from localStorage");
      loadFromLocalStorage();
      setHasLoadedFromServer(true);
    }
  }, [user, hasLoadedFromServer, loadFromLocalStorage, readLocal]);
  
  // Reset load state when user changes (login/logout)
  useEffect(() => {
    setHasLoadedFromServer(false);
  }, [user?.id]);

  // Save to localStorage (synchronous, always works)
  const saveToLocalStorage = useCallback((workout: ActiveWorkout | null, progress: TrackingProgress | null) => {
    console.log("[WorkoutContext] Saving to localStorage:", workout?.name || "null");
    if (workout) {
      localStorage.setItem(ACTIVE_WORKOUT_STORAGE_KEY, JSON.stringify(workout));
      if (progress) {
        localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(progress));
      }
    } else {
      localStorage.removeItem(ACTIVE_WORKOUT_STORAGE_KEY);
      localStorage.removeItem(TRACKING_STORAGE_KEY);
    }
  }, []);

  // Immediate save to server (no debounce) - used for critical moments
  const saveToServerImmediate = useCallback((workout: ActiveWorkout | null, progress: TrackingProgress | null) => {
    if (!userRef.current) return;
    
    // Cancel any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    if (workout) {
      // Use sendBeacon for reliability when page is closing
      const data = JSON.stringify({
        workoutData: workout,
        trackingProgress: progress,
      });
      
      // Try fetch first, with keepalive for reliability
      fetch("/api/active-workout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: data,
        credentials: "include",
        keepalive: true,
      }).catch(err => {
        console.error("Failed immediate save to server:", err);
      });
    }
  }, []);

  // Debounced save to server whenever workout or tracking progress changes
  const saveToServer = useCallback((workout: ActiveWorkout | null, progress: TrackingProgress | null) => {
    // Always save to localStorage first (synchronous backup)
    saveToLocalStorage(workout, progress);
    
    // Only save to server if user is authenticated
    if (!user) return;
    
    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Debounce server saves to avoid hammering the server
    saveTimeoutRef.current = setTimeout(() => {
      if (workout) {
        apiRequest("PUT", "/api/active-workout", {
          workoutData: workout,
          trackingProgress: progress,
        }).catch(err => {
          console.error("Failed to save to server:", err);
          // Local backup already saved, so data is safe
        });
      } else {
        apiRequest("DELETE", "/api/active-workout")
          .catch(err => console.error("Failed to delete from server:", err));
      }
    }, 300); // Reduced debounce time
  }, [user, saveToLocalStorage]);

  // Handle visibility change - save immediately when user leaves tab
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && activeWorkoutRef.current) {
        console.log("[FitYear] Visibility hidden - saving progress immediately");
        saveToLocalStorage(activeWorkoutRef.current, trackingProgressRef.current);
        saveToServerImmediate(activeWorkoutRef.current, trackingProgressRef.current);
      }
    };

    const handleBeforeUnload = () => {
      if (activeWorkoutRef.current) {
        console.log("[FitYear] Before unload - saving progress");
        saveToLocalStorage(activeWorkoutRef.current, trackingProgressRef.current);
        saveToServerImmediate(activeWorkoutRef.current, trackingProgressRef.current);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [saveToLocalStorage, saveToServerImmediate]);

  // Save whenever activeWorkout changes (after initial load)
  useEffect(() => {
    if (hasLoadedFromServer) {
      saveToServer(activeWorkout, trackingProgress);
    }
  }, [activeWorkout, hasLoadedFromServer, saveToServer, trackingProgress]);

  const saveTrackingProgress = useCallback((progress: TrackingProgress) => {
    // Update ref immediately so flushProgress has access to latest data
    trackingProgressRef.current = progress;
    setTrackingProgress(progress);
    // Don't call saveToServer here - the useEffect above will handle it
  }, []);

  const clearTrackingProgress = useCallback(() => {
    setTrackingProgress(null);
  }, []);

  // Flush progress immediately - call this before critical operations like editing
  const flushProgress = useCallback(() => {
    if (activeWorkoutRef.current) {
      console.log("[FitYear] Flushing progress immediately");
      saveToLocalStorage(activeWorkoutRef.current, trackingProgressRef.current);
      saveToServerImmediate(activeWorkoutRef.current, trackingProgressRef.current);
    }
  }, [saveToLocalStorage, saveToServerImmediate]);

  const { data: completedWorkoutsData = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/completed-workouts"],
  });

  const completedWorkouts: CompletedWorkoutRecord[] = completedWorkoutsData.map((w: any) => {
    // Robustly parse the server timestamp (no-tz strings treated as UTC).
    const completedAt = w.completedAt ? parseServerDate(w.completedAt) : new Date();

    return {
      id: w.id,
      displayId: w.displayId,
      templateId: w.templateId || null,
      name: w.name,
      exercises: (w.exercises as any[]).map((ex: any) => ({
        ...ex,
        muscleGroups: ex.muscleGroups || [],
        setsData: ex.setsData || [],
      })) as Exercise[],
      completedAt,
      calendarEventId: w.calendarEventId,
    };
  });

  const createCompletedMutation = useMutation({
    mutationFn: async (workout: {
      displayId: string;
      name: string;
      exercises: Exercise[];
      completedAt: Date;
      startedAt?: Date;
      durationSeconds?: number;
      scheduledWorkoutId?: string;
    }) => {
      const localDateStr = localDateKey(workout.completedAt);

      return apiRequest("POST", "/api/completed-workouts", {
        displayId: workout.displayId,
        name: workout.name,
        exercises: workout.exercises,
        completedAt: workout.completedAt.toISOString(),
        startedAt: workout.startedAt?.toISOString(),
        durationSeconds: workout.durationSeconds,
        localDate: localDateStr,
        scheduledWorkoutId: workout.scheduledWorkoutId,
      });
    },
    onSuccess: () => {
      setActiveWorkout(null);
      setTrackingProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/completed-workouts"] });
      if (user) {
        apiRequest("DELETE", "/api/active-workout").catch(() => {});
      }
    },
    onError: (error) => {
      console.error("Failed to save workout - data preserved:", error);
    },
  });

  const deleteCompletedMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/completed-workouts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/completed-workouts"] });
    },
  });

  const updateCompletedMutation = useMutation({
    mutationFn: async ({ id, name, exercises, completedAt }: { id: string; name: string; exercises?: any[]; completedAt?: string }) => {
      return apiRequest("PUT", `/api/completed-workouts/${id}`, { name, exercises, completedAt });
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData(["/api/completed-workouts"], (oldData: any[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map(workout => 
          workout.id === variables.id 
            ? { 
                ...workout, 
                name: variables.name, 
                exercises: variables.exercises || workout.exercises,
                ...(variables.completedAt ? { completedAt: variables.completedAt } : {}),
              }
            : workout
        );
      });
      queryClient.invalidateQueries({ queryKey: ["/api/completed-workouts"] });
    },
  });

  const deleteScheduledWorkoutMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/scheduled-workouts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
    },
  });

  const startWorkout = useCallback((workout: { id: string; displayId: string; scheduledWorkoutId?: string; name: string; exercises: Exercise[] }) => {
    const workoutWithSets: ActiveWorkout = {
      id: workout.id,
      displayId: workout.displayId,
      scheduledWorkoutId: workout.scheduledWorkoutId || null,
      name: workout.name,
      startedAt: new Date().toISOString(),
      exercises: workout.exercises.map((ex, index) => ({
        ...ex,
        instanceId: `${workout.displayId}-${index}-${Date.now()}`,
        sets: 3,
        defaultWeight: 135,
        defaultReps: 10,
      })),
    };
    setActiveWorkout(workoutWithSets);
    setLastCompletedWorkoutId(null);
  }, []);

  // Quick-start: begin an empty, unnamed workout immediately. The user adds
  // exercises while tracking (TrackPage's Add Exercise picker) and the name is
  // auto-generated from muscle groups at completion. No name/exercise gate.
  const startEmptyWorkout = useCallback(() => {
    const displayId = `quick-${Date.now()}`;
    const workout: ActiveWorkout = {
      id: displayId,
      displayId,
      scheduledWorkoutId: null,
      name: "",
      startedAt: new Date().toISOString(),
      exercises: [],
    };
    setActiveWorkout(workout);
    setLastCompletedWorkoutId(null);
  }, []);

  // Start a FitBot-generated workout: each exercise is already reconciled to a
  // real library/custom id, so this behaves like startWorkout but seeds each
  // exercise with its authored prescription (set count, target reps, rest) that
  // the Track screen honours (see lib/track-helpers.getDefaultSets). Ephemeral
  // one-off — like quick-start, it lands in History when completed, not saved as
  // a routine.
  const startGeneratedWorkout = useCallback((workout: { name: string; exercises: GeneratedWorkoutExercise[] }) => {
    const displayId = `fitbot-${Date.now()}`;
    const built: ActiveWorkout = {
      id: displayId,
      displayId,
      scheduledWorkoutId: null,
      name: workout.name?.trim() || "FitBot Workout",
      startedAt: new Date().toISOString(),
      exercises: workout.exercises.map((ex, index) => ({
        id: ex.id,
        name: ex.name,
        muscleGroups: ex.muscleGroups ?? [],
        description: ex.description ?? "",
        imageUrl: ex.imageUrl ?? null,
        exerciseType: ex.exerciseType ?? "weight_reps",
        isAssisted: ex.isAssisted ?? false,
        instanceId: `${displayId}-${index}-${Date.now()}`,
        sets: ex.sets,
        defaultWeight: 135,
        defaultReps: parseTargetReps(ex.reps) ?? 10,
        plannedSets: ex.sets,
        plannedReps: parseTargetReps(ex.reps),
        plannedRest: ex.rest,
      })),
    };
    setActiveWorkout(built);
    setLastCompletedWorkoutId(null);
  }, []);

  // Throw away the active workout without saving a completed record. Used when
  // ending an empty quick-start (no exercises) so we don't persist junk. The
  // save effect picks up the null and clears localStorage + DELETEs the server
  // active-workout row.
  const discardActiveWorkout = useCallback(() => {
    setActiveWorkout(null);
    setTrackingProgress(null);
  }, []);

  const completeWorkout = useCallback(async (exerciseSets?: Map<string, SetData[]>): Promise<string | null> => {
    if (!activeWorkout) return null;

    const exercisesWithSets = activeWorkout.exercises.map((exercise) => {
      const sets = exerciseSets?.get(exercise.instanceId);
      if (sets) {
        const normalizedSets = sets.map(s => ({
          ...s,
          weight: s.weight ?? 0,
          reps: s.reps ?? 0,
          distance: s.distance ?? 0,
          time: s.time ?? 0,
        }));
        const completedSets = normalizedSets.filter(s => s.completed);
        return {
          ...exercise,
          completedSets: completedSets.length,
          setsData: normalizedSets,
        };
      }
      // Untouched exercise (user never opened it): record it honestly as zero
      // completed sets with no set data. Previously this fabricated
      // `completedSets: exercise.sets` (a constant 3) with an empty setsData,
      // which polluted streaks/PRs and let a just-started workout look logged.
      return {
        ...exercise,
        completedSets: 0,
        setsData: [],
      };
    });

    // Auto-name from muscle groups if the user never named it (quick-start
    // flow). Editable afterwards on the workout-complete summary.
    const resolvedName = activeWorkout.name?.trim()
      ? activeWorkout.name.trim()
      : deriveWorkoutName(exercisesWithSets as never) || "Quick Workout";

    const scheduledWorkoutId = activeWorkout.scheduledWorkoutId;
    const startedAt = activeWorkout.startedAt
      ? new Date(activeWorkout.startedAt)
      : null;
    const completedAt = new Date();
    const durationSeconds = startedAt
      ? Math.max(0, Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

    try {
      const created = await createCompletedMutation.mutateAsync({
        displayId: activeWorkout.displayId,
        name: resolvedName,
        exercises: exercisesWithSets,
        completedAt,
        startedAt: startedAt ?? undefined,
        durationSeconds: durationSeconds ?? undefined,
        scheduledWorkoutId: scheduledWorkoutId || undefined,
      });

      if (scheduledWorkoutId) {
        deleteScheduledWorkoutMutation.mutate(scheduledWorkoutId);
      }

      let newId: string | null = null;
      try {
        const body = await (created as Response).json();
        newId = (body?.id as string) ?? null;
      } catch {
        newId = null;
      }
      setLastCompletedWorkoutId(newId);
      return newId;
    } catch (e) {
      console.error("[WorkoutContext] completeWorkout failed:", e);
      return null;
    }
  }, [activeWorkout, createCompletedMutation, deleteScheduledWorkoutMutation]);

  const isWorkoutCompleted = useCallback((displayId: string) => {
    return completedWorkouts.some(w => w.displayId === displayId);
  }, [completedWorkouts]);

  const restartWorkout = useCallback((completedWorkout: CompletedWorkoutRecord) => {
    const newDisplayId = `${completedWorkout.id}-restart-${Date.now()}`;
    startWorkout({
      id: completedWorkout.id,
      displayId: newDisplayId,
      name: completedWorkout.name,
      exercises: completedWorkout.exercises,
    });
  }, [startWorkout]);

  const updateCompletedWorkout = useCallback(async (id: string, name: string, exercises?: any[], completedAt?: Date): Promise<boolean> => {
    try {
      const completedAtStr = completedAt ? completedAt.toISOString() : undefined;
      await updateCompletedMutation.mutateAsync({ id, name, exercises, completedAt: completedAtStr });
      return true;
    } catch (error) {
      console.error("Failed to update completed workout:", error);
      return false;
    }
  }, [updateCompletedMutation]);

  const deleteCompletedWorkout = useCallback((id: string) => {
    deleteCompletedMutation.mutate(id);
  }, [deleteCompletedMutation]);

  const updateActiveWorkout = useCallback((name: string, exercises: Exercise[]) => {
    if (activeWorkout) {
      // Build a pool of old instanceIds keyed by exercise id (in order), so we
      // can hand them out to matching exercises that somehow lost their instanceId.
      const oldInstanceIdPool = new Map<string, string[]>();
      for (const ex of activeWorkout.exercises) {
        const iid = (ex as any).instanceId;
        if (!iid) continue;
        if (!oldInstanceIdPool.has(ex.id)) oldInstanceIdPool.set(ex.id, []);
        oldInstanceIdPool.get(ex.id)!.push(iid);
      }
      const poolConsumed = new Map<string, number>();

      const updatedExercises = exercises.map((ex, index) => {
        // The editor passes exercises straight from selectedExercises, which was
        // seeded from activeWorkout.exercises, so each already carries its instanceId.
        // Honour that first – this is the correct fix for the deletion-shift bug.
        const existingInstanceId = (ex as any).instanceId as string | undefined;
        if (existingInstanceId) {
          return { ...ex, instanceId: existingInstanceId, sets: 3, defaultWeight: 135, defaultReps: 10 };
        }

        // Fallback: match by exercise id in insertion order (handles newly added exercises
        // that were looked up from the library and therefore lack an instanceId).
        const pool = oldInstanceIdPool.get(ex.id) || [];
        const consumed = poolConsumed.get(ex.id) || 0;
        const instanceId = pool[consumed] ?? `${activeWorkout.displayId}-${ex.id}-${index}-${Date.now()}`;
        poolConsumed.set(ex.id, consumed + 1);

        return { ...ex, instanceId, sets: 3, defaultWeight: 135, defaultReps: 10 };
      });

      setActiveWorkout({
        ...activeWorkout,
        name,
        exercises: updatedExercises,
      });
    }
  }, [activeWorkout]);

  // Stable context value: prevents the entire consumer subtree from re-rendering
  // every time the provider re-renders. Tracking screens read from this on every
  // set/rep edit, so identity stability is the difference between snappy and laggy.
  const value = useMemo(
    () => ({
      activeWorkout,
      completedWorkouts,
      isLoading,
      trackingProgress,
      lastCompletedWorkoutId,
      startWorkout,
      startEmptyWorkout,
      startGeneratedWorkout,
      discardActiveWorkout,
      completeWorkout,
      isWorkoutCompleted,
      restartWorkout,
      updateCompletedWorkout,
      deleteCompletedWorkout,
      updateActiveWorkout,
      saveTrackingProgress,
      clearTrackingProgress,
      flushProgress,
    }),
    [
      activeWorkout,
      completedWorkouts,
      isLoading,
      trackingProgress,
      lastCompletedWorkoutId,
      startWorkout,
      startEmptyWorkout,
      startGeneratedWorkout,
      discardActiveWorkout,
      completeWorkout,
      isWorkoutCompleted,
      restartWorkout,
      updateCompletedWorkout,
      deleteCompletedWorkout,
      updateActiveWorkout,
      saveTrackingProgress,
      clearTrackingProgress,
      flushProgress,
    ],
  );

  return (
    <WorkoutContext.Provider value={value}>
      {children}
    </WorkoutContext.Provider>
  );
}

export function useWorkout() {
  const context = useContext(WorkoutContext);
  if (!context) {
    throw new Error("useWorkout must be used within a WorkoutProvider");
  }
  return context;
}
