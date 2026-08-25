/**
 * "Recently added" ordering for the exercise pickers.
 *
 * Creating an exercise and then having to hunt for it alphabetically in a
 * 126-item catalog is the problem this solves: a newly created exercise sorts
 * to the top of the picker and is marked, for a window, then settles back into
 * the normal ordering.
 *
 * `exercises.created_at` is NULLABLE with no backfill on purpose (see
 * scripts/apply-exercise-created-at.ts): every exercise that predates the
 * column is null, which reads here as "not recent". So the whole pre-existing
 * catalog behaves exactly as it did before, and only genuinely new rows float.
 */

export const RECENT_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Structurally minimal on purpose: the two pickers pass different concrete
 * exercise types, so this only names the fields the ordering actually reads.
 */
interface PickerExercise {
  name: string;
  muscleGroups?: string[] | null;
  createdAt?: string | Date | null;
}

/** Epoch ms for a created-at that may be a Date, an ISO string, null, or junk. */
export function createdAtMs(ex: Pick<PickerExercise, "createdAt">): number | null {
  const raw = ex.createdAt;
  if (raw == null) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

/** True when the exercise entered the catalog inside the recent window. */
export function isRecentlyAdded(
  ex: Pick<PickerExercise, "createdAt">,
  now: number = Date.now(),
): boolean {
  const t = createdAtMs(ex);
  if (t === null) return false;
  // A clock-skewed future timestamp still counts as recent rather than never.
  return now - t < RECENT_WINDOW_DAYS * DAY_MS;
}

/**
 * Recently added first (newest first), then the picker's normal ordering:
 * coarse muscle group, then name. Pure and non-mutating.
 */
export function sortForPicker<T extends PickerExercise>(
  exercises: readonly T[],
  now: number = Date.now(),
): T[] {
  return [...exercises].sort((a, b) => {
    const aRecent = isRecentlyAdded(a, now);
    const bRecent = isRecentlyAdded(b, now);
    if (aRecent !== bRecent) return aRecent ? -1 : 1;
    if (aRecent && bRecent) {
      // Newest first among the recent ones.
      const at = createdAtMs(a) ?? 0;
      const bt = createdAtMs(b) ?? 0;
      if (at !== bt) return bt - at;
    }
    const muscleA = (a.muscleGroups?.[0] || "").toLowerCase();
    const muscleB = (b.muscleGroups?.[0] || "").toLowerCase();
    if (muscleA !== muscleB) return muscleA.localeCompare(muscleB);
    return a.name.localeCompare(b.name);
  });
}
