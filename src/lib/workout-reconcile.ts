import {
  matchExercise,
  normalizeExerciseName,
  type ExerciseCandidate,
} from "@/lib/exercise-match";
import type { GeneratedExercise } from "@/lib/workout-schema";

/**
 * Reconciliation planning for the single-workout flow.
 *
 * When the user starts a FitBot-generated workout, each suggested exercise is
 * either an existing library movement (reuse its identity so history/PRs/progress
 * stay linked) or genuinely new (create a custom exercise). This is the PURE
 * planning half: given the generated exercises + the current catalog, decide
 * per exercise whether to reuse or create. The actual DB writes + startWorkout
 * wiring live in the route/client (runtime, design-adjacent) and consume this
 * plan.
 *
 * `createKey` is the normalized name of a to-be-created exercise. The executor
 * creates one custom exercise per UNIQUE createKey and maps every plan item with
 * that key to the resulting id, so a workout that lists the same new movement
 * twice (e.g. two set schemes) never creates duplicate library rows.
 */
export interface ReconcileResult {
  index: number;
  source: GeneratedExercise;
  action: "reuse" | "create";
  exerciseId?: string; // reuse: the matched library exercise id
  matchedName?: string; // reuse: the matched library exercise name
  createKey?: string; // create: normalized name (dedup key for creation)
}

export function planReconciliation(
  generated: GeneratedExercise[],
  catalog: ExerciseCandidate[],
  threshold?: number,
): ReconcileResult[] {
  return generated.map((source, index) => {
    const match = matchExercise(source.name, catalog, threshold);
    if (match) {
      return {
        index,
        source,
        action: "reuse",
        exerciseId: match.id,
        matchedName: match.name,
      };
    }
    return {
      index,
      source,
      action: "create",
      createKey: normalizeExerciseName(source.name),
    };
  });
}

/** The distinct exercises that need creating (one per unique createKey). */
export function distinctCreates(plan: ReconcileResult[]): GeneratedExercise[] {
  const seen = new Set<string>();
  const out: GeneratedExercise[] = [];
  for (const item of plan) {
    if (item.action !== "create" || !item.createKey) continue;
    if (seen.has(item.createKey)) continue;
    seen.add(item.createKey);
    out.push(item.source);
  }
  return out;
}
