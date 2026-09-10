/**
 * Movement families, so a goal counts every variation of the same movement.
 *
 * Ivo, 2026-09-10: "any kind of push up or pull up variation should be tracked
 * cumulatively in my goals... any variation of those (including chin ups)."
 *
 * A goal used to match on the catalog id, so a goal on Push-ups counted only
 * that exact row: the deficit ones, the parallettes ones and the pike ones all
 * went uncounted, which for a calisthenics program is most of the work. Reps
 * are reps, and a family is how the app says so.
 *
 * WHY MATCH ON THE NAME rather than muscle groups: muscle groups would sweep in
 * every pressing movement (a bench press is Chest and Triceps too). The family
 * is about the MOVEMENT, and the movement is what the name records - which is
 * safe here precisely because names are canonicalised on every write.
 *
 * Pure and dependency-free so both the history page and the tracker can use it.
 */

export type MovementFamily = "push-up" | "pull-up";

/**
 * Fold a name to letters only, lowercased.
 *
 * This is what makes the family robust to the four spellings the catalog
 * genuinely contains: "Push-ups", "Pushups", "Push Ups", "Push-Up" all become
 * "pushups". House spelling is "Push-ups" but history keeps its own name
 * snapshot, so older rows carry whatever they were called at the time.
 */
function fold(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Terms that identify each family, already folded.
 *
 * Chin-ups are in the pull-up family because Ivo said so, and he is right: it
 * is the same movement with a different grip.
 */
const FAMILY_TERMS: Record<MovementFamily, string[]> = {
  "push-up": ["pushup"],
  "pull-up": ["pullup", "chinup"],
};

/**
 * Names that CONTAIN a family term but are a different movement.
 *
 * None of the current catalog trips this - "Pushdown" folds to "pushdown" and
 * "Lat Pulldown" to "latpulldown", neither of which contains "pushup" or
 * "pullup" - but a "Push Up Row" style name would, and the guard costs nothing.
 * Keep it as an exact folded-name list rather than a substring rule, or it will
 * start excluding the variations it exists to protect.
 */
const NOT_A_FAMILY_MEMBER = new Set<string>([]);

/**
 * The family an exercise belongs to, or null for everything else.
 *
 * Deliberately NOT a fuzzy match. `lib/exercise-match` exists to decide whether
 * two names are the same exercise; this is a coarser question and a wrong
 * answer here silently inflates a goal, so it uses a term the name either
 * contains or does not.
 */
export function familyOf(name: string): MovementFamily | null {
  const folded = fold(name);
  if (!folded || NOT_A_FAMILY_MEMBER.has(folded)) return null;
  for (const [family, terms] of Object.entries(FAMILY_TERMS)) {
    if (terms.some((t) => folded.includes(t))) return family as MovementFamily;
  }
  return null;
}

/**
 * Does a logged exercise count toward a goal?
 *
 * Family first, id second. A goal on an exercise with no family keeps the old
 * exact-id behavior, so nothing outside push-ups and pull-ups changes.
 */
export function countsTowardGoal(
  goal: { exerciseId: string; exerciseName: string },
  logged: { id?: string | null; name: string },
): boolean {
  const family = familyOf(goal.exerciseName);
  if (family) return familyOf(logged.name) === family;
  return logged.id != null && logged.id === goal.exerciseId;
}

/** A human label for the family, for telling the user what is being counted. */
export function familyLabel(family: MovementFamily): string {
  return family === "push-up" ? "push-up variations" : "pull-up and chin-up variations";
}
