import { queryClient } from "@/lib/queryClient";

// App-owned localStorage keys that hold user data. Cleared on logout and on an
// account switch so one user's data never leaks to the next on a shared device.
// `theme` is intentionally EXCLUDED — it's a device display preference, not PII,
// and clearing it would make logout visibly flip the app's light/dark mode.
// `fy_last_uid` is also excluded (managed by the auth hook to detect switches).
const USER_DATA_KEYS = [
  "fy-query-cache", // persisted React Query cache (whole workout history, PRs, settings)
  "active_workout",
  "workout_tracking_progress",
  "customMuscleGroups",
  "muscleGroups",
  "muscleGroupsMigrated",
  "restTimerOnManualComplete",
  "showKgConversion",
  "weekStart",
];

/**
 * Purge all locally-cached user data. Called on explicit logout and when a
 * different account signs in on the same device.
 *
 * `queryClient.clear()` alone is NOT enough: the PersistQueryClientProvider
 * writes the cache back to localStorage on the next tick, so we must also
 * remove the `fy-query-cache` key (done via USER_DATA_KEYS below). Clearing the
 * in-memory cache first means any re-persist that races writes an empty cache.
 *
 * Plain function (no React hooks) so it can be called from event handlers and
 * auth-state listeners. Wrapped in try/catch because localStorage can throw in
 * private-browsing / storage-disabled contexts.
 */
export function clearLocalUserData(): void {
  try {
    queryClient.clear();
  } catch {
    // ignore — clearing the in-memory cache should never throw, but be safe
  }
  if (typeof window === "undefined") return;
  for (const key of USER_DATA_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // localStorage can throw (private mode / disabled) — keep purging the rest
    }
  }
}
