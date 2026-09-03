"use client";

import { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { deriveWorkoutName, type SetData } from "@/lib/workout-stats";
import { resolveWorkoutDuration } from "@/lib/workout-duration";
import { buildResumeState, combinedDuration } from "@/lib/resume-workout";
import { parseServerDate, localDateKey } from "@/lib/date";
import { type Exercise } from "@/data/exercises";
import { useAuth } from "@/hooks/use-auth";

export interface WorkoutExercise extends Exercise {
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
  // A saved FitBot program day carries a per-week target load on its anchor
  // lifts (routine_entries.exercises.targetLoadLbs, copied verbatim onto the
  // scheduled workout). Threaded through startWorkout so the Track screen can
  // prefill the weight column. Does NOT change row count (see planOf on Track).
  plannedLoadLbs?: number | null;
}

interface ActiveWorkout {
  id: string;
  displayId: string;
  scheduledWorkoutId: string | null;
  name: string;
  exercises: WorkoutExercise[];
  startedAt?: string; // ISO string — set on startWorkout, used for duration on complete
  /**
   * Set when this session REOPENED an already-finished workout. Finishing then
   * updates that workout instead of creating a second one, so a session picked
   * up later stays one workout with one summary. Lives in the workout_data
   * jsonb, so it needs no column.
   */
  resumedFromCompletedId?: string | null;
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

/** What the workout and history editors hand back. Deliberately looser than
 *  `Exercise`: those screens rebuild each row from what is on the page, so
 *  catalog-only fields are absent, and `sets`/`defaultWeight`/`defaultReps`
 *  are per-workout values that may or may not have been set yet. */
/** What the WORKOUT editor and the add-exercise picker hand to
 *  `updateActiveWorkout`: a real catalog exercise (they come from the picker,
 *  so identity is guaranteed) whose per-workout numbers are optional, because
 *  a freshly picked exercise has not been given any yet. `carry` below is what
 *  fills them in without clobbering a prescription the user already has. */
export type WorkoutExerciseInput = Exercise & {
  instanceId?: string;
  sets?: number;
  defaultWeight?: number;
  defaultReps?: number;
  plannedSets?: number;
  plannedReps?: number | null;
  plannedRest?: number;
  plannedLoadLbs?: number | null;
};

export type EditedExercise = Omit<Partial<WorkoutExercise>, "setsData"> & {
  name: string;
  setsData?: EditedSet[];
};

/** A set mid-edit. Every field is optional because the History editor binds its
 *  inputs to `value ?? ""` and writes `undefined` when one is cleared - storing
 *  0 there is what made an auto-added row impossible to clear (2026-07-16). The
 *  save path coerces the blanks by exercise type, so the loose shape never
 *  reaches the database; it only ever exists between a keystroke and a save. */
export type EditedSet = Partial<SetData>;

/** A completed-workout row exactly as `/api/completed-workouts` returns it,
 *  before the mapping below turns it into a CompletedWorkoutRecord. */
export interface CompletedWorkoutRow {
  id: string;
  displayId: string;
  templateId?: string | null;
  name: string;
  exercises: Exercise[];
  completedAt?: string | null;
  startedAt?: string | null;
  durationSeconds?: number | null;
  calendarEventId?: string | null;
}

export interface CompletedWorkoutRecord {
  id: string;
  displayId: string;
  templateId?: string | null;
  name: string;
  exercises: Exercise[];
  completedAt: Date;
  // Training time in seconds. Null on legacy rows that predate the column, and
  // on rows saved without a start time; History falls back to the timestamp
  // span in that case.
  durationSeconds?: number | null;
  startedAt?: Date | string | null;
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
  // Epoch ms of the last local write. Used as the primary signal when the same
  // workout exists on two devices: set count alone cannot tell a stale copy
  // from a deliberate un-check, so the older copy would resurrect the removed
  // sets. Optional for progress saved before this field existed.
  savedAt?: number;
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
  /** Reopen a finished workout and keep training it. False if there is nothing to resume. */
  resumeWorkout: (completedWorkout: CompletedWorkoutRecord) => boolean;
  updateCompletedWorkout: (id: string, name: string, exercises?: EditedExercise[], completedAt?: Date, durationSeconds?: number) => Promise<boolean>;
  deleteCompletedWorkout: (id: string) => void;
  updateActiveWorkout: (name: string, exercises: WorkoutExerciseInput[]) => void;
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
  // True once this session has held a real active workout, so a subsequent null
  // state means "the workout ended" and not "we loaded nothing".
  const hadWorkoutRef = useRef(false);
  
  // Refs to track current state for immediate saves (visibility change, beforeunload)
  const activeWorkoutRef = useRef<ActiveWorkout | null>(null);
  const trackingProgressRef = useRef<TrackingProgress | null>(null);
  const userRef = useRef(user);
  // Non-null while a completeWorkout save is in flight (see completeWorkout).
  const completeInFlightRef = useRef<Promise<string | null> | null>(null);
  
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

  // How much work a saved progress blob actually represents, used to decide
  // which copy wins when the same workout exists on two devices.
  const countTrackedSets = (progress: TrackingProgress | null): number => {
    if (!progress?.exerciseSets) return 0;
    let n = 0;
    for (const [, sets] of progress.exerciseSets) {
      for (const s of sets ?? []) if (s?.completed) n++;
    }
    return n;
  };

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
          // Seed from the PERSISTED stamp so reopening the app hours later is
          // not mistaken for activity. Only a genuine content change advances
          // it from here.
          if (typeof trackingData.savedAt === "number") {
            lastActivityAtRef.current = trackingData.savedAt;
          }
          lastProgressSigRef.current = progressSignature(progress);
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
        .then(res => {
          // An HTTP error is a LOAD FAILURE, not "you have no workout". Treating
          // a transient 500 as an empty result meant a device with no local copy
          // restored nothing and then deleted the real server row (see the
          // hadWorkoutRef guard in saveToServer). Throw so the catch below falls
          // back to localStorage instead.
          if (!res.ok) throw new Error(`active-workout load failed: ${res.status}`);
          return res.json();
        })
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
          // ...EXCEPT when this device has no progress for that workout but the
          // server does. That is the cross-device case: start on the phone, log
          // sets on the laptop, reopen the phone. Blindly preferring local then
          // showed an empty tracker and the next autosave overwrote the
          // server's sets with nothing.
          const localSetCount = countTrackedSets(localProgress);
          const serverSetCount = countTrackedSets(serverProgress);
          const sameWorkout =
            !!localWorkout && !!serverWorkout && serverWorkout.displayId === localWorkout.displayId;

          // For the SAME workout on two devices, recency decides. Set count is
          // only a fallback for progress saved before `savedAt` existed: it
          // cannot distinguish a stale copy from a deliberate un-check, so
          // "more sets wins" silently reverted corrections made elsewhere.
          const localSavedAt = localProgress?.savedAt;
          const serverSavedAt = serverProgress?.savedAt;
          const serverIsFresher =
            sameWorkout &&
            (localSavedAt != null && serverSavedAt != null
              ? serverSavedAt > localSavedAt
              : serverSetCount > localSetCount);

          const preferLocal =
            !!localWorkout && (!serverWorkout || sameWorkout) && !serverIsFresher;

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

  // --- last real interaction, for the duration correction -------------------
  // "When did the user last actually do something in this workout", as opposed
  // to "when was state last persisted". The two diverge in exactly the case
  // that matters: training ends, the app sits idle for hours, the user reopens
  // it and hits Finish. A plain persistence timestamp would be refreshed by
  // that reopen and report a four-hour workout; this only advances when the
  // progress CONTENT changes, and is seeded from the persisted stamp on
  // restore so a restore alone never counts as activity.
  const lastActivityAtRef = useRef<number | null>(null);
  const lastProgressSigRef = useRef<string | null>(null);

  const progressSignature = (progress: TrackingProgress | null): string => {
    if (!progress) return "";
    // savedAt is excluded: it is the stamp, not the content.
    const { savedAt: _savedAt, ...content } = progress as TrackingProgress & { savedAt?: number };
    return JSON.stringify(content);
  };

  // Save to localStorage (synchronous, always works)
  const saveToLocalStorage = useCallback((workout: ActiveWorkout | null, progress: TrackingProgress | null) => {
    console.log("[WorkoutContext] Saving to localStorage:", workout?.name || "null");
    // Guarded: this runs inside a render effect, and the React Query cache is
    // persisted into the same origin bucket, so a quota-exceeded (or disabled
    // storage) throw here used to escape into the error boundary and kill the
    // tracking page mid-workout. The server save is the durable copy.
    try {
      if (workout) {
        localStorage.setItem(ACTIVE_WORKOUT_STORAGE_KEY, JSON.stringify(workout));
        if (progress) {
          // Stamped here (the single write path for both the local copy and,
          // via saveToServer, the server one) so both carry the same clock.
          // The stamp only ADVANCES when the content changed, so re-persisting
          // an unchanged workout (a reopen, a re-render) does not make an idle
          // session look active - see lastActivityAtRef above.
          const sig = progressSignature(progress);
          if (sig !== lastProgressSigRef.current) {
            lastProgressSigRef.current = sig;
            lastActivityAtRef.current = Date.now();
          }
          localStorage.setItem(
            TRACKING_STORAGE_KEY,
            JSON.stringify({ ...progress, savedAt: lastActivityAtRef.current ?? Date.now() }),
          );
        }
      } else {
        localStorage.removeItem(ACTIVE_WORKOUT_STORAGE_KEY);
        localStorage.removeItem(TRACKING_STORAGE_KEY);
      }
    } catch (e) {
      console.error("[WorkoutContext] localStorage save failed:", e);
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
      } else if (hadWorkoutRef.current) {
        // Only after a workout actually ended this session (completed or
        // discarded). Without the guard, merely LOADING nothing issued a DELETE
        // - harmless on a normal empty open, but destructive when the load had
        // failed and the server still held a live workout.
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
      // Marks that this session has held a real workout, which is what makes a
      // later null state mean "it ended" rather than "we never had one".
      if (activeWorkout) hadWorkoutRef.current = true;
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

  const { data: completedWorkoutsData = [], isLoading } = useQuery<CompletedWorkoutRow[]>({
    queryKey: ["/api/completed-workouts"],
  });

  const completedWorkouts: CompletedWorkoutRecord[] = completedWorkoutsData.map((w) => {
    // Robustly parse the server timestamp (no-tz strings treated as UTC).
    const completedAt = w.completedAt ? parseServerDate(w.completedAt) : new Date();

    return {
      id: w.id,
      displayId: w.displayId,
      templateId: w.templateId || null,
      name: w.name,
      exercises: w.exercises.map((ex) => ({
        ...ex,
        muscleGroups: ex.muscleGroups || [],
        setsData: ex.setsData || [],
      })),
      completedAt,
      // Carried through so History can show (and correct) the training time.
      // These were dropped here, which is why duration_seconds was written on
      // every workout and then never surfaced anywhere in the UI.
      durationSeconds: typeof w.durationSeconds === "number" ? w.durationSeconds : null,
      startedAt: w.startedAt ? parseServerDate(w.startedAt) : null,
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
    mutationFn: async ({ id, name, exercises, completedAt, localDate, durationSeconds }: { id: string; name: string; exercises?: EditedExercise[]; completedAt?: string; localDate?: string; durationSeconds?: number }) => {
      return apiRequest("PUT", `/api/completed-workouts/${id}`, { name, exercises, completedAt, localDate, durationSeconds });
    },
    onSuccess: (_, variables) => {
      queryClient.setQueryData(["/api/completed-workouts"], (oldData: CompletedWorkoutRow[] | undefined) => {
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
    // Already mid-session on this exact workout (the card stays on Home until
    // it's completed, so tapping back into it is easy): CONTINUE it. Re-minting
    // instanceIds here used to strand every logged set - the saved progress is
    // keyed by instanceId, and for a scheduled workout the displayId is stable,
    // so the old progress restored against dead keys and the sets vanished from
    // the UI and saved as zero.
    if (activeWorkoutRef.current?.displayId === workout.displayId) return;

    // A different workout: the previous session's progress must not leak into
    // it (same reason - the keys belong to the old instanceIds).
    trackingProgressRef.current = null;
    setTrackingProgress(null);

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
        // Surface a FitBot program day's per-anchor target load to Track (weight
        // prefill only; row count stays the historic default). Absent -> null.
        plannedLoadLbs: (ex as { targetLoadLbs?: number | null }).targetLoadLbs ?? null,
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
    // In-flight guard: a double-tap on Finish must not fire two saves. The
    // second caller gets the SAME promise (same workout id), not an error.
    // The server's (user_id, display_id) idempotency is the hard backstop.
    if (completeInFlightRef.current) return completeInFlightRef.current;
    const run = (async (): Promise<string | null> => {

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
    // Forgetting to press Finish used to record the idle tail as training time
    // (a one-hour session logged as four). The last real interaction is the
    // honest end of the workout; resolveWorkoutDuration only trims when the
    // idle gap is unambiguous, so genuine long rests are untouched.
    const { durationSeconds, trimmed, rawSeconds } = resolveWorkoutDuration({
      startedAt,
      completedAt,
      lastActivityAt: lastActivityAtRef.current,
    });
    if (trimmed) {
      console.log(
        `[WorkoutContext] duration trimmed: ${rawSeconds}s elapsed -> ${durationSeconds}s of training ` +
          `(idle tail after the last logged set)`,
      );
    }

    // A resumed session belongs to the workout it reopened: update that row
    // rather than inserting a second one, or "continue" would silently split a
    // single session into two workouts on the same day.
    const resumedId = activeWorkout.resumedFromCompletedId;
    if (resumedId) {
      const original = completedWorkouts.find((w) => w.id === resumedId);
      try {
        await updateCompletedMutation.mutateAsync({
          id: resumedId,
          name: resolvedName,
          exercises: exercisesWithSets,
          // The gap between sittings is not training time, so the durations add
          // instead of the clock running through the break.
          durationSeconds: combinedDuration(original?.durationSeconds, durationSeconds),
        });
        setActiveWorkout(null);
        setTrackingProgress(null);
        activeWorkoutRef.current = null;
        trackingProgressRef.current = null;
        setLastCompletedWorkoutId(resumedId);
        return resumedId;
      } catch (e) {
        console.error("[WorkoutContext] resumed completeWorkout failed:", e);
        return null;
      }
    }

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
    })();
    completeInFlightRef.current = run;
    try {
      return await run;
    } finally {
      completeInFlightRef.current = null;
    }
  }, [activeWorkout, completedWorkouts, createCompletedMutation, deleteScheduledWorkoutMutation, updateCompletedMutation]);

  const isWorkoutCompleted = useCallback((displayId: string) => {
    return completedWorkouts.some(w => w.displayId === displayId);
  }, [completedWorkouts]);

  /**
   * Reopen a finished workout and keep training it.
   *
   * Distinct from restartWorkout, which starts a fresh SEPARATE session from an
   * old one. This continues the same workout: every exercise comes back with
   * its rows exactly as logged, and finishing updates that workout rather than
   * creating a second one.
   */
  const resumeWorkout = useCallback((completedWorkout: CompletedWorkoutRecord) => {
    const displayId = `${completedWorkout.id}-resume-${Date.now()}`;
    const { exercises, exerciseSets } = buildResumeState(
      completedWorkout.exercises as never,
      displayId,
    );
    if (exercises.length === 0) return false;

    const resumed = {
      id: completedWorkout.id,
      displayId,
      scheduledWorkoutId: null,
      name: completedWorkout.name,
      startedAt: new Date().toISOString(),
      resumedFromCompletedId: completedWorkout.id,
      exercises,
    } as unknown as ActiveWorkout;

    // Progress FIRST in the refs, so the autosave that follows the state change
    // cannot race a null progress over the restored sets.
    const progress: TrackingProgress = {
      workoutDisplayId: displayId,
      exerciseSets,
      currentExerciseIndex: 0,
      currentSetIndex: 0,
      restTimerDuration: 90,
      // Stored weights are lbs; TrackPage converts on load if the user is on kg.
      weightUnit: "lbs",
      savedAt: Date.now(),
    };
    activeWorkoutRef.current = resumed;
    trackingProgressRef.current = progress;
    setActiveWorkout(resumed);
    setTrackingProgress(progress);
    hadWorkoutRef.current = true;
    return true;
  }, []);

  const restartWorkout = useCallback((completedWorkout: CompletedWorkoutRecord) => {
    const newDisplayId = `${completedWorkout.id}-restart-${Date.now()}`;
    startWorkout({
      id: completedWorkout.id,
      displayId: newDisplayId,
      name: completedWorkout.name,
      exercises: completedWorkout.exercises,
    });
  }, [startWorkout]);

  const updateCompletedWorkout = useCallback(async (id: string, name: string, exercises?: EditedExercise[], completedAt?: Date, durationSeconds?: number): Promise<boolean> => {
    try {
      const completedAtStr = completedAt ? completedAt.toISOString() : undefined;
      // Local calendar day alongside the UTC timestamp, so the server moves the
      // all-day Google Calendar event to the day the user actually picked.
      const localDate = completedAt ? localDateKey(completedAt) : undefined;
      await updateCompletedMutation.mutateAsync({ id, name, exercises, completedAt: completedAtStr, localDate, durationSeconds });
      return true;
    } catch (error) {
      console.error("Failed to update completed workout:", error);
      return false;
    }
  }, [updateCompletedMutation]);

  const deleteCompletedWorkout = useCallback((id: string) => {
    deleteCompletedMutation.mutate(id);
  }, [deleteCompletedMutation]);

  const updateActiveWorkout = useCallback((name: string, exercises: WorkoutExerciseInput[]) => {
    if (activeWorkout) {
      // Build a pool of old instanceIds keyed by exercise id (in order), so we
      // can hand them out to matching exercises that somehow lost their instanceId.
      const oldInstanceIdPool = new Map<string, string[]>();
      for (const ex of activeWorkout.exercises) {
        const iid = ex.instanceId;
        if (!iid) continue;
        if (!oldInstanceIdPool.has(ex.id)) oldInstanceIdPool.set(ex.id, []);
        oldInstanceIdPool.get(ex.id)!.push(iid);
      }
      const poolConsumed = new Map<string, number>();

      // Prior state by instanceId, so an edit can keep each exercise's own
      // prescription instead of overwriting it.
      const priorByInstance = new Map<string, WorkoutExercise>();
      for (const ex of activeWorkout.exercises) {
        const iid = ex.instanceId;
        if (iid) priorByInstance.set(iid, ex);
      }

      // These used to be hardcoded to `sets: 3, defaultWeight: 135,
      // defaultReps: 10` on EVERY exercise at EVERY save, so opening the editor
      // and saving silently rewrote a programmed 5x5 into 3 sets and reset the
      // rep default - a change the user never asked for and could not see until
      // they were mid-set. Carry the exercise's own values through, fall back to
      // whatever the instance already had, and only then to the old constants
      // (which is what a genuinely new exercise from the picker still gets).
      const carry = (ex: WorkoutExerciseInput, prior: WorkoutExercise | undefined) => ({
        sets: ex.sets ?? prior?.sets ?? 3,
        defaultWeight: ex.defaultWeight ?? prior?.defaultWeight ?? 135,
        defaultReps: ex.defaultReps ?? prior?.defaultReps ?? 10,
      });

      const updatedExercises = exercises.map((ex, index) => {
        // The editor passes exercises straight from selectedExercises, which was
        // seeded from activeWorkout.exercises, so each already carries its instanceId.
        // Honour that first – this is the correct fix for the deletion-shift bug.
        const existingInstanceId = ex.instanceId;
        if (existingInstanceId) {
          const prior = priorByInstance.get(existingInstanceId);
          return { ...ex, instanceId: existingInstanceId, ...carry(ex, prior) };
        }

        // Fallback: match by exercise id in insertion order (handles newly added exercises
        // that were looked up from the library and therefore lack an instanceId).
        const pool = oldInstanceIdPool.get(ex.id) || [];
        const consumed = poolConsumed.get(ex.id) || 0;
        const instanceId = pool[consumed] ?? `${activeWorkout.displayId}-${ex.id}-${index}-${Date.now()}`;
        poolConsumed.set(ex.id, consumed + 1);

        return { ...ex, instanceId, ...carry(ex, priorByInstance.get(instanceId)) };
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
      resumeWorkout,
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
      resumeWorkout,
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
