/**
 * Fuzzy exercise-name matching.
 *
 * FitBot generates workouts unbounded by the library (it invents whatever is
 * most effective for the request). At the moment the user starts the workout we
 * reconcile each suggested exercise against the existing catalog so a user's
 * history / PRs / progress stay linked to ONE exercise instead of fragmenting
 * across near-duplicates ("Bulgarian Split Squat" vs "Split Squat Bulgarian").
 * This module is the matcher: given a candidate name and the catalog, return the
 * best existing match, or null when nothing is close enough (the caller then
 * creates a new custom exercise).
 *
 * Design bias: prefer NOT matching when uncertain. A missed match just creates
 * one extra custom exercise; a WRONG match merges two distinct movements into a
 * single corrupted progress history. So the fallback token-overlap threshold is
 * deliberately high (0.8), and "close but distinct" pairs (e.g. "Split Squat" vs
 * "Bulgarian Split Squat", "Bench Press" vs "Leg Press") intentionally do NOT
 * match, they create a new exercise instead.
 *
 * Match signals, strongest first:
 *   1.00  exact after normalization ("Deadlift" == "deadlift")
 *   0.97  identical once spaces are removed + plurals folded ("Push Up" == "Pushup")
 *   0.95  identical token SET, order-insensitive ("Bulgarian Split Squat" == "Split Squat Bulgarian")
 *   <1    Jaccard overlap of the token sets; matches only if >= threshold
 */

export const DEFAULT_MATCH_THRESHOLD = 0.8;

/** Lowercase, turn any run of punctuation into a single space, trim + collapse. */
export function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Fold a single token toward a rough singular stem so plural variants match
 * ("curls" -> "curl", "pushups" -> "pushup", "raises" -> "raise", "flies" ->
 * "fly", "presses" -> "press"). Short tokens are left alone so we never mangle
 * words like "abs" or strip the trailing double-s of "press".
 */
function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return token.slice(0, -3) + "y";
  if (token.endsWith("sses")) return token.slice(0, -2); // presses -> press
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -1); // raises -> raise, glutes -> glute
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1); // curls -> curl (keep press)
  return token;
}

interface Analyzed {
  normalized: string;
  condensed: string; // singularized tokens joined with no spaces
  tokens: string[]; // sorted, unique, singularized
}

function analyze(name: string): Analyzed {
  const normalized = normalizeExerciseName(name);
  const raw = normalized ? normalized.split(" ") : [];
  const singular = raw.map(singularize);
  return {
    normalized,
    condensed: singular.join(""),
    tokens: Array.from(new Set(singular)).sort(),
  };
}

function setEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const bSet = new Set(b);
  let inter = 0;
  for (const t of a) if (bSet.has(t)) inter++;
  const union = a.length + b.length - inter;
  return union === 0 ? 0 : inter / union;
}

function scorePair(a: Analyzed, b: Analyzed): number {
  if (!a.normalized || !b.normalized) return 0;
  if (a.normalized === b.normalized) return 1;
  if (a.condensed && a.condensed === b.condensed) return 0.97;
  if (setEqual(a.tokens, b.tokens)) return 0.95;
  return jaccard(a.tokens, b.tokens);
}

/** Similarity of two exercise names in [0, 1]. Exposed for testing + tuning. */
export function nameMatchScore(a: string, b: string): number {
  return scorePair(analyze(a), analyze(b));
}

export interface ExerciseCandidate {
  id: string;
  name: string;
}

export interface ExerciseMatch {
  id: string;
  name: string;
  score: number;
}

/**
 * Best catalog match for `candidateName`, or null if nothing clears `threshold`.
 * Ties resolve to the highest score, then to the first catalog entry seen.
 */
export function matchExercise(
  candidateName: string,
  catalog: ExerciseCandidate[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): ExerciseMatch | null {
  const cand = analyze(candidateName);
  if (!cand.normalized) return null;
  let best: ExerciseMatch | null = null;
  for (const entry of catalog) {
    const score = scorePair(cand, analyze(entry.name));
    if (score >= threshold && (best === null || score > best.score)) {
      best = { id: entry.id, name: entry.name, score };
    }
  }
  return best;
}
