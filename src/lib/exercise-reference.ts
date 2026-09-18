import reference from "@/lib/data/exercise-reference.json";
import { matchExercise } from "@/lib/exercise-match";

/**
 * A read-only vocabulary of standard exercise names to suggest from and
 * reconcile against.
 *
 * Ivo, 2026-09-17: "i still want a free database to have as exercises so users
 * and fitbot can draw and reconcile against a good database."
 *
 * **This is not the catalog and must never become it.** Nothing here is a row,
 * nothing has an id, and nothing is imported. The catalog is what this user has
 * actually trained, grown deliberately and cleaned up twice; this is a list of
 * names that EXIST IN THE WORLD, consulted when something new is being named.
 * The distinction is what keeps the earlier objections from applying: no
 * renaming, no migration, no change to exercise identity.
 *
 * TWO SOURCES, merged because they barely overlap: Free Exercise DB (public
 * domain, classic barbell/dumbbell/machine work) and Strength to Overcome
 * (functional, calisthenics, rings, parallettes, kettlebells, with a
 * demonstration video on most entries). FitYear's own catalog straddles both.
 * Provenance, licence terms and the muscle mapping are documented in
 * `scripts/build-exercise-reference.ts`; muscles were resolved into FitYear's
 * coarse groups at BUILD time, so nothing here speaks a foreign vocabulary.
 *
 * SERVER ONLY, and there is no `server-only` import enforcing it because this
 * project does not carry that dependency and adding one to a Next build has
 * bitten it before. The data file is ~635KB and must never reach a client
 * bundle. Its only consumer is `lib/ai/fitbot-reads.ts`, which runs in a route
 * handler. **If you import this from a "use client" file, check the bundle.**
 */

export type ReferenceExercise = {
  name: string;
  equipment: string | null;
  /** FitYear coarse groups, resolved at build time. */
  muscles: string[];
  secondary: string[];
  /** "compound" | "isolation" | null */
  mechanic: string | null;
  /** "push" | "pull" | "static" | null */
  force: string | null;
  /** A YouTube id where the source had one. Embedded, never re-hosted. */
  videoId?: string;
};

const ALL = reference as ReferenceExercise[];

export function referenceSize(): number {
  return ALL.length;
}

/**
 * Search the reference by name and/or muscle group.
 *
 * Substring rather than fuzzy, deliberately. This answers "what standard names
 * contain these words", which is a search box's job; deciding whether two names
 * are the SAME movement is `matchExercise`'s job and is a different question
 * with a threshold tuned for it.
 */
export function searchReference(
  opts: { query?: string; muscleGroup?: string; limit?: number } = {},
): ReferenceExercise[] {
  const q = opts.query?.trim().toLowerCase();
  const group = opts.muscleGroup?.trim().toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 60);

  let out = ALL;
  if (q) out = out.filter((e) => e.name.toLowerCase().includes(q));
  if (group) {
    out = out.filter((e) =>
      [...e.muscles, ...e.secondary].some((m) => m.toLowerCase() === group),
    );
  }
  // Shortest name first: the plainest form of a movement is the one worth
  // suggesting, and the source is full of long grip and stance variants.
  return [...out].sort((a, b) => a.name.length - b.name.length).slice(0, limit);
}

/**
 * The standard name for something the user typed, if there is one.
 *
 * Uses the app's OWN matcher at its own threshold, so a suggestion here obeys
 * exactly the rules the duplicate guard does. Returns null rather than a weak
 * guess: proposing the wrong canonical name is worse than proposing none,
 * because the name is what every history snapshot is keyed on.
 */
export function canonicalNameFor(input: string): ReferenceExercise | null {
  const hit = matchExercise(
    input,
    ALL.map((e, i) => ({ id: String(i), name: e.name })),
  );
  return hit ? ALL[Number(hit.id)] : null;
}
