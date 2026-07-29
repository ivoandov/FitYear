/**
 * Persistence shape + restore rules for the rest timer.
 *
 * The timer counts down to an absolute `endTime`, so elapsed time survives a
 * suspended JS engine (iOS freezes background tabs). What it did NOT survive
 * before 2026-07-21 was the page being DISCARDED: nothing read the saved end
 * time at mount, so leaving the app mid-rest lost the timer entirely.
 *
 * Kept pure (no localStorage, no Date.now) so the restore decisions are unit
 * tested; TimerContext owns the storage + React wiring.
 */

export interface RestTimerState {
  /** ms epoch when the countdown reaches zero. null while paused. */
  endTime: number | null;
  /** seconds left while paused. null while running. */
  pausedRemaining: number | null;
  /** the full rest duration, for the progress ring */
  initialSeconds: number;
  exerciseName: string;
  nextExerciseName?: string;
  /**
   * Id of the scheduled closed-app push for this rest, so a restored timer can
   * still cancel the right alert when the user skips ahead.
   */
  restId?: string;
}

export type RestoreDecision =
  | { status: "none" }
  | { status: "expired" }
  | { status: "running"; remaining: number; state: RestTimerState }
  | { status: "paused"; remaining: number; state: RestTimerState };

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Parse the persisted blob, falling back to the pre-2026-07-21 two-key format
 * (`rest_timer_end_time` / `rest_timer_paused_remaining`) so a rest running
 * across the deploy still restores. The legacy format carried no metadata, so
 * the remaining time doubles as `initialSeconds` (the ring starts full rather
 * than mid-sweep - cosmetic, and only for that one-deploy window).
 */
export function parseRestTimerState(
  raw: string | null,
  legacyEnd: string | null,
  legacyPausedRemaining: string | null,
  now: number,
): RestTimerState | null {
  if (raw) {
    try {
      const p = JSON.parse(raw) as Partial<RestTimerState>;
      const initialSeconds = isPositiveInt(p.initialSeconds) ? p.initialSeconds : 1;
      const exerciseName = typeof p.exerciseName === "string" && p.exerciseName ? p.exerciseName : "Rest";
      const nextExerciseName = typeof p.nextExerciseName === "string" ? p.nextExerciseName : undefined;
      const restId = typeof p.restId === "string" ? p.restId : undefined;
      if (isPositiveInt(p.pausedRemaining)) {
        return { endTime: null, pausedRemaining: p.pausedRemaining, initialSeconds, exerciseName, nextExerciseName, restId };
      }
      if (isPositiveInt(p.endTime)) {
        return { endTime: p.endTime, pausedRemaining: null, initialSeconds, exerciseName, nextExerciseName, restId };
      }
      return null;
    } catch {
      return null; // corrupt blob - treat as absent, caller clears it
    }
  }

  if (legacyPausedRemaining) {
    const rem = parseInt(legacyPausedRemaining, 10);
    if (!isPositiveInt(rem)) return null;
    return { endTime: null, pausedRemaining: rem, initialSeconds: rem, exerciseName: "Rest" };
  }
  if (legacyEnd) {
    const end = parseInt(legacyEnd, 10);
    if (!isPositiveInt(end)) return null;
    const remaining = Math.max(1, Math.ceil((end - now) / 1000));
    return { endTime: end, pausedRemaining: null, initialSeconds: remaining, exerciseName: "Rest" };
  }
  return null;
}

/**
 * What to do with a persisted state at mount (or when re-opening the timer).
 *
 * `expired` means the rest finished while the app was away: the caller clears
 * storage and shows nothing. It deliberately does NOT fire the completion
 * buzz/notification - announcing a rest that ended minutes or hours ago is
 * noise, and resurrecting it as a 00:00 timer was the bug that made the NEXT
 * rest read "done" immediately.
 */
export function decideRestore(state: RestTimerState | null, now: number): RestoreDecision {
  if (!state) return { status: "none" };
  if (state.pausedRemaining != null) {
    return state.pausedRemaining > 0
      ? { status: "paused", remaining: state.pausedRemaining, state }
      : { status: "expired" };
  }
  if (state.endTime == null) return { status: "none" };
  const remaining = Math.max(0, Math.ceil((state.endTime - now) / 1000));
  return remaining > 0 ? { status: "running", remaining, state } : { status: "expired" };
}
