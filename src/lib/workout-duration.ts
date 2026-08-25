/**
 * How long a workout actually took.
 *
 * The naive answer - `completedAt - startedAt` - is wrong in a very common
 * case: you finish training, forget to hit Finish Workout, and tap it hours
 * later while the app has been sitting idle. The session then records as four
 * hours instead of one, which then pollutes every average and total built on
 * top of it.
 *
 * The app already knows when you last actually did something: `savedAt` is
 * stamped onto the tracking progress on every local write (a set completed,
 * edited or unchecked). So when there is a long idle gap between that last real
 * interaction and the moment Finish was pressed, the workout plainly ended at
 * the last interaction, and the gap is just the app being left open.
 *
 * This is deliberately conservative. It only trims when the idle gap is big
 * enough to be unambiguous, so a genuine long rest, a phone call mid-session or
 * a slow gym queue is left alone.
 */

/** Idle gap beyond which the tail is treated as "forgot to press Finish". */
export const IDLE_TRIM_THRESHOLD_SECONDS = 20 * 60;

export interface DurationInput {
  /** When the workout began. Null for legacy rows that never recorded it. */
  startedAt: Date | null;
  /** When Finish was pressed. */
  completedAt: Date;
  /** Epoch ms of the last real interaction (TrackingProgress.savedAt). */
  lastActivityAt?: number | null;
}

export interface DurationResult {
  /** Seconds to record, or null when there is no start time to measure from. */
  durationSeconds: number | null;
  /** True when the idle tail was trimmed off. */
  trimmed: boolean;
  /** The raw untrimmed duration, for explaining the correction to the user. */
  rawSeconds: number | null;
}

export function resolveWorkoutDuration({
  startedAt,
  completedAt,
  lastActivityAt,
}: DurationInput): DurationResult {
  if (!startedAt) return { durationSeconds: null, trimmed: false, rawSeconds: null };

  const startMs = startedAt.getTime();
  const endMs = completedAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { durationSeconds: null, trimmed: false, rawSeconds: null };
  }

  const rawSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));

  // No usable activity stamp (legacy progress, or a workout completed without
  // ever logging a set) - fall back to the raw span.
  if (lastActivityAt == null || !Number.isFinite(lastActivityAt)) {
    return { durationSeconds: rawSeconds, trimmed: false, rawSeconds };
  }

  // An activity stamp before the start, or after the finish, is nonsense
  // (clock skew, a restored older blob). Ignore it rather than trust it.
  if (lastActivityAt <= startMs || lastActivityAt > endMs) {
    return { durationSeconds: rawSeconds, trimmed: false, rawSeconds };
  }

  const idleSeconds = Math.floor((endMs - lastActivityAt) / 1000);
  if (idleSeconds < IDLE_TRIM_THRESHOLD_SECONDS) {
    return { durationSeconds: rawSeconds, trimmed: false, rawSeconds };
  }

  const trimmedSeconds = Math.max(0, Math.floor((lastActivityAt - startMs) / 1000));
  return { durationSeconds: trimmedSeconds, trimmed: true, rawSeconds };
}

/** "1h 12m" / "48m" / "45s". Used in history and on the complete screen. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

/** Parse "1h 12m", "72m", "1:12" or "72" (minutes) into seconds. Null if unusable. */
export function parseDurationInput(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const hm = /^(\d+)\s*:\s*([0-5]?\d)$/.exec(s);
  if (hm) return Number(hm[1]) * 3600 + Number(hm[2]) * 60;

  let total = 0;
  let matched = false;
  const hours = /(\d+(?:\.\d+)?)\s*h/.exec(s);
  if (hours) {
    total += Number(hours[1]) * 3600;
    matched = true;
  }
  const mins = /(\d+(?:\.\d+)?)\s*m/.exec(s);
  if (mins) {
    total += Number(mins[1]) * 60;
    matched = true;
  }
  if (matched) return Math.round(total);

  // A bare number means minutes, which is how people say it out loud.
  const bare = /^\d+(?:\.\d+)?$/.exec(s);
  if (bare) return Math.round(Number(bare[0]) * 60);

  return null;
}
