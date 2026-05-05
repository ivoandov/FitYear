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

const TIMER_STORAGE_KEY = "rest_timer_end_time";
const TIMER_PAUSED_KEY = "rest_timer_paused_remaining";

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

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendTimerCompleteNotification(exerciseName: string) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Rest Complete", {
      body: `Time to start your next ${exerciseName} set!`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "rest-timer",
    });
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

  const tick = useCallback(() => {
    const remaining = computeRemaining();
    setSeconds(remaining);
    if (remaining <= 0) {
      clearInterval_();
      localStorage.removeItem(TIMER_STORAGE_KEY);
      localStorage.removeItem(TIMER_PAUSED_KEY);
      if (!hasCompletedRef.current) {
        hasCompletedRef.current = true;
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
        sendTimerCompleteNotification(exerciseName);
      }
    }
  }, [computeRemaining, clearInterval_, exerciseName]);

  const startCounting = useCallback(
    (remainingSecs: number) => {
      clearInterval_();
      hasCompletedRef.current = false;
      endTimeRef.current = Date.now() + remainingSecs * 1000;
      localStorage.setItem(TIMER_STORAGE_KEY, String(endTimeRef.current));
      localStorage.removeItem(TIMER_PAUSED_KEY);
      intervalRef.current = setInterval(tick, 500);
      tick();
    },
    [clearInterval_, tick],
  );

  const openTimer = useCallback(
    (opts: {
      initialSeconds: number;
      exerciseName: string;
      nextExerciseName?: string;
      onClose: () => void;
    }) => {
      clearInterval_();
      hasCompletedRef.current = false;
      endTimeRef.current = null;

      setInitialSeconds(opts.initialSeconds);
      setExerciseName(opts.exerciseName);
      setNextExerciseName(opts.nextExerciseName);
      setIsMinimized(false);
      setIsPaused(false);
      setSeconds(opts.initialSeconds);
      onCloseRef.current = opts.onClose;

      requestNotificationPermission();

      const savedEnd = localStorage.getItem(TIMER_STORAGE_KEY);
      const savedPaused = localStorage.getItem(TIMER_PAUSED_KEY);

      if (savedPaused) {
        const rem = parseInt(savedPaused, 10);
        setSeconds(rem);
        setIsPaused(true);
        endTimeRef.current = null;
      } else if (savedEnd) {
        const end = parseInt(savedEnd, 10);
        const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        if (remaining > 0) {
          endTimeRef.current = end;
          setSeconds(remaining);
          setIsPaused(false);
          intervalRef.current = setInterval(tick, 500);
          tick();
        } else {
          localStorage.removeItem(TIMER_STORAGE_KEY);
          setSeconds(0);
          if (!hasCompletedRef.current) {
            hasCompletedRef.current = true;
            if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
            sendTimerCompleteNotification(opts.exerciseName);
          }
        }
      } else {
        startCounting(opts.initialSeconds);
      }

      setIsOpen(true);
    },
    [clearInterval_, tick, startCounting],
  );

  const closeTimer = useCallback(() => {
    clearInterval_();
    endTimeRef.current = null;
    hasCompletedRef.current = false;
    localStorage.removeItem(TIMER_STORAGE_KEY);
    localStorage.removeItem(TIMER_PAUSED_KEY);
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
      localStorage.removeItem(TIMER_STORAGE_KEY);
      localStorage.setItem(TIMER_PAUSED_KEY, String(seconds));
      setIsPaused(true);
    }
  }, [isPaused, seconds, startCounting, clearInterval_]);

  useEffect(() => {
    if (!isOpen) return;
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !isPaused) {
        clearInterval_();
        const remaining = computeRemaining();
        setSeconds(remaining);
        if (remaining > 0) {
          intervalRef.current = setInterval(tick, 500);
        } else if (!hasCompletedRef.current) {
          hasCompletedRef.current = true;
          if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
          sendTimerCompleteNotification(exerciseName);
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, [isOpen, isPaused, computeRemaining, clearInterval_, tick, exerciseName]);

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
