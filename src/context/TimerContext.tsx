"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  decideRestore,
  parseRestTimerState,
  type RestTimerState,
} from "@/lib/rest-timer-state";

const TIMER_STATE_KEY = "rest_timer_state_v1";
// Pre-2026-07-21 keys, read once for migration then cleared.
const LEGACY_END_KEY = "rest_timer_end_time";
const LEGACY_PAUSED_KEY = "rest_timer_paused_remaining";

function readState(now: number): RestTimerState | null {
  try {
    return parseRestTimerState(
      localStorage.getItem(TIMER_STATE_KEY),
      localStorage.getItem(LEGACY_END_KEY),
      localStorage.getItem(LEGACY_PAUSED_KEY),
      now,
    );
  } catch {
    return null; // private mode / storage disabled
  }
}

function writeState(state: RestTimerState) {
  try {
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(state));
    localStorage.removeItem(LEGACY_END_KEY);
    localStorage.removeItem(LEGACY_PAUSED_KEY);
  } catch {
    /* private mode - the timer still runs, it just won't survive a reload */
  }
}

function clearState() {
  try {
    localStorage.removeItem(TIMER_STATE_KEY);
    localStorage.removeItem(LEGACY_END_KEY);
    localStorage.removeItem(LEGACY_PAUSED_KEY);
  } catch {
    /* no-op */
  }
}

interface TimerContextType {
  isOpen: boolean;
  isMinimized: boolean;
  seconds: number;
  isPaused: boolean;
  initialSeconds: number;
  exerciseName: string;
  nextExerciseName: string | undefined;
  openTimer: (opts: {
    initialSeconds: number;
    exerciseName: string;
    nextExerciseName?: string;
    onClose: () => void;
  }) => void;
  closeTimer: () => void;
  setIsMinimized: (v: boolean) => void;
  pauseResume: () => void;
}

const TimerContext = createContext<TimerContextType | null>(null);

export function useTimer() {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error("useTimer must be used within TimerProvider");
  return ctx;
}

/**
 * The closed-app half of the alert: a Vercel Workflow sleeps for the rest and
 * pushes when it wakes, because a suspended page cannot fire its own
 * notification. Only armed when the user has granted permission (otherwise
 * there is no subscription to deliver to). All fire-and-forget - the local
 * countdown must never wait on, or fail because of, the network.
 */
function restPushEnabled(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted"
  );
}

function scheduleRestPush(restId: string, delaySeconds: number, exerciseName: string) {
  if (!restPushEnabled() || delaySeconds < 5) return;
  fetch("/api/push/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ restId, delaySeconds: Math.round(delaySeconds), exerciseName }),
    // The whole point of this request is to arm an alert for a phone that is
    // about to be locked. Without keepalive, backgrounding the app right after
    // the tap tears the request down and no alert is ever scheduled.
    keepalive: true,
  }).catch(() => {});
}

function cancelRestPush(restId: string | null) {
  if (!restId || !restPushEnabled()) return;
  fetch("/api/push/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ restId }),
    // Survives the page being torn down mid-request (skip -> navigate away).
    keepalive: true,
  }).catch(() => {});
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendTimerCompleteNotification(exerciseName: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options: NotificationOptions = {
    body: `Time to start your next ${exerciseName} set!`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "rest-timer",
  };
  // `new Notification()` is an illegal constructor on Android Chrome and in
  // installed iOS PWAs - the only supported path there is the service worker's
  // showNotification. Try that first and fall back for desktop browsers that
  // have no registration.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (registration) return registration.showNotification("Rest Complete", options);
        new Notification("Rest Complete", options);
      })
      .catch(() => {});
    return;
  }
  try {
    new Notification("Rest Complete", options);
  } catch {
    /* unsupported - the vibrate + on-screen timer are the fallback */
  }
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [seconds, setSeconds] = useState(90);
  const [isPaused, setIsPaused] = useState(false);
  const [initialSeconds, setInitialSeconds] = useState(90);
  const [exerciseName, setExerciseName] = useState("Rest");
  const [nextExerciseName, setNextExerciseName] = useState<string | undefined>();
  const onCloseRef = useRef<(() => void) | null>(null);
  const endTimeRef = useRef<number | null>(null);
  const hasCompletedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Metadata mirrored into refs: the running interval and the persistence
  // writers need the CURRENT values synchronously, before a setState flush.
  const initialSecondsRef = useRef(90);
  const exerciseNameRef = useRef("Rest");
  const nextExerciseNameRef = useRef<string | undefined>(undefined);
  // Identifies the currently scheduled closed-app push, so it can be cancelled
  // when the rest ends early or finishes while the app is open.
  const restIdRef = useRef<string | null>(null);
  // Mirrors `isOpen` for the openTimer guard below (state is a render behind).
  const isOpenRef = useRef(false);

  const setMeta = useCallback(
    (opts: { initialSeconds: number; exerciseName: string; nextExerciseName?: string }) => {
      initialSecondsRef.current = Math.max(1, opts.initialSeconds);
      exerciseNameRef.current = opts.exerciseName;
      nextExerciseNameRef.current = opts.nextExerciseName;
      setInitialSeconds(Math.max(1, opts.initialSeconds));
      setExerciseName(opts.exerciseName);
      setNextExerciseName(opts.nextExerciseName);
    },
    [],
  );

  const clearInterval_ = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const computeRemaining = useCallback((): number => {
    if (!endTimeRef.current) return 0;
    return Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
  }, []);

  const complete = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    sendTimerCompleteNotification(exerciseNameRef.current);
  }, []);

  // Reads the exercise name from a ref, so the running interval never fires a
  // notification with a stale name captured at setInterval time.
  const tick = useCallback(() => {
    const remaining = computeRemaining();
    setSeconds(remaining);
    if (remaining <= 0) {
      clearInterval_();
      clearState();
      // The app is open, so the local notification above is the alert - drop
      // the scheduled push rather than buzzing the user twice.
      cancelRestPush(restIdRef.current);
      restIdRef.current = null;
      complete();
    }
  }, [computeRemaining, clearInterval_, complete]);

  const startCounting = useCallback(
    (remainingSecs: number) => {
      clearInterval_();
      hasCompletedRef.current = false;
      const endTime = Date.now() + remainingSecs * 1000;
      endTimeRef.current = endTime;
      // A NEW id per arming, not per rest period. Re-arming after a pause
      // leaves the first workflow sleeping, and it would otherwise wake to find
      // the shared row back at `pending` and fire early (mid-rest) while the
      // real end-of-rest alert is skipped. Retiring the previous id makes that
      // stale workflow a no-op.
      const previousRestId = restIdRef.current;
      const restId = crypto.randomUUID();
      restIdRef.current = restId;
      if (previousRestId) cancelRestPush(previousRestId);
      writeState({
        endTime,
        pausedRemaining: null,
        initialSeconds: initialSecondsRef.current,
        exerciseName: exerciseNameRef.current,
        nextExerciseName: nextExerciseNameRef.current,
        restId,
      });
      scheduleRestPush(restId, remainingSecs, exerciseNameRef.current);
      intervalRef.current = setInterval(tick, 500);
      tick();
    },
    [clearInterval_, tick],
  );

  // Restore a rest that was running when the app was backgrounded and the page
  // then DISCARDED (routine on iOS/Android). Comes back as the minimized pill,
  // never the full-screen dialog: RestTimer only renders on /track, so a
  // non-minimized restore on any other route would be an invisible timer. One
  // tap on the pill expands it.
  useEffect(() => {
    const decision = decideRestore(readState(Date.now()), Date.now());
    if (decision.status === "none") return;
    if (decision.status === "expired") {
      // Finished while away: drop it silently. Leaving the key behind is what
      // made the NEXT rest timer open already "complete".
      clearState();
      return;
    }
    const { state, remaining } = decision;
    setMeta({
      initialSeconds: state.initialSeconds,
      exerciseName: state.exerciseName,
      nextExerciseName: state.nextExerciseName,
    });
    // Adopt the rest's existing push id: the workflow scheduled before the app
    // died is still sleeping, so this timer must be able to cancel it.
    restIdRef.current = state.restId ?? null;
    hasCompletedRef.current = false;
    setSeconds(remaining);
    setIsMinimized(true);
    isOpenRef.current = true;
    setIsOpen(true);
    if (decision.status === "paused") {
      endTimeRef.current = null;
      setIsPaused(true);
      return;
    }
    endTimeRef.current = state.endTime;
    setIsPaused(false);
    intervalRef.current = setInterval(tick, 500);
    return () => clearInterval_();
    // Mount only: this is a one-shot rehydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTimer = useCallback(
    (opts: {
      initialSeconds: number;
      exerciseName: string;
      nextExerciseName?: string;
      onClose: () => void;
    }) => {
      // A rest that already finished is still on screen (the user minimized it
      // and it ran out). Re-entering /track re-invokes openTimer, and starting
      // a fresh countdown here would silently begin a rest the user never asked
      // for AND advance the set pointer when it is dismissed. Keep the finished
      // timer; just adopt the new close callback.
      if (isOpenRef.current && hasCompletedRef.current) {
        onCloseRef.current = opts.onClose;
        return;
      }
      clearInterval_();
      hasCompletedRef.current = false;
      endTimeRef.current = null;

      setMeta(opts);
      setIsMinimized(false);
      setIsPaused(false);
      setSeconds(opts.initialSeconds);
      onCloseRef.current = opts.onClose;

      requestNotificationPermission();

      // A live saved rest means we're re-entering the SAME rest period (the
      // track page re-opens the timer after a remount or a tab round trip), so
      // continue it. Anything expired or absent starts a fresh countdown -
      // an expired rest must never resurrect as an instantly-done timer.
      const decision = decideRestore(readState(Date.now()), Date.now());
      // Continuing a rest keeps its scheduled alert; a fresh rest gets a new id
      // from startCounting.
      restIdRef.current =
        decision.status === "paused" || decision.status === "running"
          ? (decision.state.restId ?? null)
          : null;
      if (decision.status === "paused") {
        endTimeRef.current = null;
        setSeconds(decision.remaining);
        setIsPaused(true);
        writeState({
          endTime: null,
          pausedRemaining: decision.remaining,
          initialSeconds: initialSecondsRef.current,
          exerciseName: exerciseNameRef.current,
          nextExerciseName: nextExerciseNameRef.current,
          restId: restIdRef.current ?? undefined,
        });
      } else if (decision.status === "running") {
        endTimeRef.current = decision.state.endTime;
        setSeconds(decision.remaining);
        setIsPaused(false);
        writeState({
          endTime: decision.state.endTime,
          pausedRemaining: null,
          initialSeconds: initialSecondsRef.current,
          exerciseName: exerciseNameRef.current,
          nextExerciseName: nextExerciseNameRef.current,
          restId: restIdRef.current ?? undefined,
        });
        intervalRef.current = setInterval(tick, 500);
        tick();
      } else {
        clearState();
        startCounting(opts.initialSeconds);
      }

      isOpenRef.current = true;

      setIsOpen(true);
    },
    [clearInterval_, tick, startCounting, setMeta],
  );

  const closeTimer = useCallback(() => {
    clearInterval_();
    endTimeRef.current = null;
    hasCompletedRef.current = false;
    clearState();
    // Skipping to the next set ends the rest early - drop the pending alert so
    // it doesn't buzz mid-set.
    cancelRestPush(restIdRef.current);
    restIdRef.current = null;
    isOpenRef.current = false;
    setIsOpen(false);
    setIsMinimized(false);
    setIsPaused(false);
    setSeconds(initialSeconds);
    const cb = onCloseRef.current;
    onCloseRef.current = null;
    cb?.();
  }, [clearInterval_, initialSeconds]);

  const pauseResume = useCallback(() => {
    if (isPaused) {
      startCounting(seconds);
      setIsPaused(false);
    } else {
      clearInterval_();
      endTimeRef.current = null;
      writeState({
        endTime: null,
        pausedRemaining: seconds,
        initialSeconds: initialSecondsRef.current,
        exerciseName: exerciseNameRef.current,
        nextExerciseName: nextExerciseNameRef.current,
        restId: restIdRef.current ?? undefined,
      });
      // A paused rest has no end time, so retire the pending alert; resuming
      // re-arms it with the remaining seconds.
      cancelRestPush(restIdRef.current);
      setIsPaused(true);
    }
  }, [isPaused, seconds, startCounting, clearInterval_]);

  // Coming back to a still-alive page (backgrounded, JS frozen): recompute from
  // the absolute end time rather than trusting interval ticks that never ran.
  useEffect(() => {
    if (!isOpen) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !isPaused) {
        clearInterval_();
        const remaining = computeRemaining();
        setSeconds(remaining);
        if (remaining > 0) {
          intervalRef.current = setInterval(tick, 500);
        } else if (endTimeRef.current) {
          // How long ago the rest actually ended. Returning within the grace
          // window means the user is still in the set and the alert is useful;
          // coming back much later (locked the phone, came back 15 minutes
          // on) must NOT buzz - the closed-app push already covered it, and a
          // stale "rest complete" is pure noise. Same rule as the mount
          // rehydrate, which drops an expired rest silently.
          const endedSecondsAgo = (Date.now() - endTimeRef.current) / 1000;
          clearState();
          cancelRestPush(restIdRef.current);
          restIdRef.current = null;
          if (endedSecondsAgo <= 60) complete();
          else hasCompletedRef.current = true;
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [isOpen, isPaused, computeRemaining, clearInterval_, tick, complete]);

  return (
    <TimerContext.Provider
      value={{
        isOpen,
        isMinimized,
        seconds,
        isPaused,
        initialSeconds,
        exerciseName,
        nextExerciseName,
        openTimer,
        closeTimer,
        setIsMinimized,
        pauseResume,
      }}
    >
      {children}
    </TimerContext.Provider>
  );
}
