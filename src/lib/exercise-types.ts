/**
 * The exercise TYPES and, more usefully, what each one measures.
 *
 * There were two types for most of this app's life, so the codebase is full of
 * `exerciseType === "distance_time"` branches that really mean "does this use
 * distance?", "does this use reps?", "does this use weight?" - three different
 * questions that happened to have the same answer while there were only two
 * types. Adding `weight_time` (Ivo, 2026-08-28: "plate pinch - 25lbs weight, 60
 * seconds. neutral hangs - bodyweight so 0 weight, 45 secs") splits them apart,
 * so ask the capability rather than compare the type.
 *
 * The column is plain `text` with a `weight_reps` default and NO database
 * constraint, so a new member needs no migration - but every reader that
 * branches binarily needs revisiting, which is what these predicates are for.
 */
export const EXERCISE_TYPES = ["weight_reps", "distance_time", "weight_time"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const DEFAULT_EXERCISE_TYPE: ExerciseType = "weight_reps";

/** Anything unrecognised becomes weight_reps, which is what the column defaults to. */
export function normalizeExerciseType(v: unknown): ExerciseType {
  if (typeof v !== "string") return DEFAULT_EXERCISE_TYPE;
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((EXERCISE_TYPES as readonly string[]).includes(s)) return s as ExerciseType;
  // Models and importers do not send the enum, they send a word. Split those by
  // what is actually being measured.
  //
  // Only words that can ONLY mean a static hold map to weight_time. A bare
  // "time" or "duration" stays distance_time: it is genuinely ambiguous (a
  // plank and a 500m row interval are both "time"), and the observed model
  // output that this tolerance exists for was conditioning work. Guessing
  // wrong on a timed row loses its distance, so the ambiguous case keeps the
  // behaviour that was tuned against real output.
  //
  // Setting weight_time deliberately is what the exercise editor is for; this
  // function only cleans up input nobody chose.
  if (/(isometric|plank|\bhang|pinch|dead_hang|static)/.test(s)) return "weight_time";
  if (/(time|duration|distance|cardio|run|jog|walk|sprint|bike|cycl|row|swim|mile|km|interval|conditioning|carry|hold)/.test(s)) {
    return "distance_time";
  }
  return DEFAULT_EXERCISE_TYPE;
}

/** Loaded lifts and holds. A bodyweight hold is simply 0 weight. */
export const usesWeight = (t: string | null | undefined): boolean =>
  normalizeExerciseType(t) === "weight_reps" || normalizeExerciseType(t) === "weight_time";

export const usesReps = (t: string | null | undefined): boolean =>
  normalizeExerciseType(t) === "weight_reps";

/** Held or travelled for a duration. */
export const usesTime = (t: string | null | undefined): boolean =>
  normalizeExerciseType(t) === "distance_time" || normalizeExerciseType(t) === "weight_time";

export const usesDistance = (t: string | null | undefined): boolean =>
  normalizeExerciseType(t) === "distance_time";

/**
 * Whether "volume" (weight x reps) means anything. It does not for a hold: 25 lb
 * for 60 s is not 1500 of any unit anyone trains by, and treating it as volume
 * would put holds on the same leaderboard as squats.
 */
export const hasVolume = (t: string | null | undefined): boolean =>
  normalizeExerciseType(t) === "weight_reps";

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  weight_reps: "Weight & reps",
  distance_time: "Distance & time",
  weight_time: "Weight & time",
};

export const EXERCISE_TYPE_HINTS: Record<ExerciseType, string> = {
  weight_reps: "Most lifts. Log a load and a rep count.",
  distance_time: "Cardio. Log a distance and a duration.",
  weight_time: "Holds and carries. Log a load and a duration - use 0 for bodyweight.",
};
