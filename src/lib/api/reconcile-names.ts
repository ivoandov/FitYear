import { matchExercise, normalizeExerciseName, type ExerciseCandidate } from "@/lib/exercise-match";
import { canonicalExerciseName } from "@/lib/exercise-naming";

/**
 * Names arriving from a model, reconciled against the shared catalog.
 *
 * ONE implementation, used by FitBot's program save and by the integration
 * door, because it is a write rule: a name that matches an existing exercise is
 * rewritten to that exercise's own spelling so the program reuses its identity,
 * history and image instead of spawning a near-duplicate. A genuinely new
 * movement is de-duplicated within the program (first spelling wins) and stored
 * under the house naming convention. Only the display name changes; the
 * prescription beside it is untouched.
 *
 * Lifted verbatim out of `api/ai/save-program` on 2026-09-23 so the second
 * caller could not drift from the first.
 */
export interface NameReconciler {
  reconcile(raw: string): string;
  /** Every rewrite, for the caller's response and its logs. */
  renamed: Array<{ from: string; to: string }>;
  /** Names that matched nothing and will be created on first use. */
  created: string[];
  /** How many names were changed on the way in. */
  reconciledCount: number;
}

export function makeNameReconciler(catalog: ExerciseCandidate[]): NameReconciler {
  const chosenForNew = new Map<string, string>();
  const renamed: Array<{ from: string; to: string }> = [];
  const created: string[] = [];
  let reconciledCount = 0;
  const note = (from: string, to: string) => {
    if (from !== to) {
      reconciledCount++;
      renamed.push({ from, to });
    }
  };
  return {
    renamed,
    created,
    get reconciledCount() {
      return reconciledCount;
    },
    reconcile(raw: string): string {
      const match = matchExercise(raw, catalog);
      if (match) {
        note(raw, match.name);
        return match.name;
      }
      const key = normalizeExerciseName(raw);
      const prior = chosenForNew.get(key);
      if (prior !== undefined) {
        note(raw, prior);
        return prior;
      }
      const canonical = canonicalExerciseName(raw);
      note(raw, canonical);
      chosenForNew.set(key, canonical);
      if (!created.includes(canonical)) created.push(canonical);
      return canonical;
    },
  };
}
