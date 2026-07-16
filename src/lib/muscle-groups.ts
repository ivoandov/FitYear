// Two-tier muscle-group taxonomy (ratified by Claude Design 2026-07-16).
//
// TIER 1 - COARSE: the fixed, ordered vocabulary shown in the exercise-picker
// chips, the Settings muscle manager, and the Insights "volume by muscle" cards.
// TIER 2 - SPECIFIC: finer muscles kept on each exercise (shown nested when
// tracking/planning/on the detail page), each rolling up to exactly one coarse
// group. Nothing is lost - specifics live on the exercise; the coarse group is
// derived for the crowded surfaces.
//
// Ivo's copy calls: the rehab bucket is "PT" (not "Prehab"); the core chip stays
// "Abs/Core". Coarse order is a fixed push/pull/legs-ish anatomy order (Design's
// call), NOT alphabetical or by count.

export const COARSE_MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms",
  "Abs/Core",
  "Legs",
  "Cardio",
  "PT",
] as const;

export type CoarseGroup = (typeof COARSE_MUSCLE_GROUPS)[number];

// Specific muscles per coarse group (display order within each group). A coarse
// group with an empty array simply has no finer breakdown today.
export const SPECIFICS_BY_COARSE: Record<CoarseGroup, string[]> = {
  Chest: [],
  Back: ["Lats", "Upper Back", "Lower Back", "Traps"],
  Shoulders: ["Front Delts", "Side Delts", "Rear Delts", "Rotator Cuff"],
  Biceps: ["Brachialis"],
  Triceps: [],
  Forearms: [],
  "Abs/Core": ["Obliques"],
  Legs: ["Glutes", "Hamstrings", "Quads", "Calves", "Hip Abductors"],
  Cardio: [],
  PT: ["Ankle PT", "Knee PT", "Shoulder PT"],
};

const COARSE_SET = new Set<string>(COARSE_MUSCLE_GROUPS);

// specific canonical label -> its coarse group
const SPECIFIC_TO_COARSE: Record<string, CoarseGroup> = {};
for (const coarse of COARSE_MUSCLE_GROUPS) {
  for (const spec of SPECIFICS_BY_COARSE[coarse]) {
    SPECIFIC_TO_COARSE[spec] = coarse;
  }
}

// lower(label) -> canonical label, for every coarse + specific (case-insensitive
// resolution of already-canonical strings).
const CANONICAL_BY_KEY = new Map<string, string>();
for (const coarse of COARSE_MUSCLE_GROUPS) CANONICAL_BY_KEY.set(coarse.toLowerCase(), coarse);
for (const spec of Object.keys(SPECIFIC_TO_COARSE)) CANONICAL_BY_KEY.set(spec.toLowerCase(), spec);

// Synonym / junk-string map: lowercased raw -> canonical label (coarse OR
// specific). Codifies the historical freeform strings so they normalize instead
// of crowding. Anything NOT here and not already canonical is "unmatched" and
// gets quarantined (dropped from the tag list, reported by the migration) rather
// than surfacing as an invented chip - that freeform-chip path was the original rot.
const SYNONYMS: Record<string, string> = {
  // Abs/Core
  abs: "Abs/Core",
  abdominals: "Abs/Core",
  core: "Abs/Core",
  obliques: "Obliques",
  // Chest
  pecs: "Chest",
  pectorals: "Chest",
  // Back
  lats: "Lats",
  "latissimus dorsi": "Lats",
  "upper back": "Upper Back",
  "lower back": "Lower Back",
  "thoracic spine": "Back",
  traps: "Traps",
  trapezius: "Traps",
  rhomboids: "Back",
  // Shoulders
  delts: "Shoulders",
  deltoids: "Shoulders",
  "front delts": "Front Delts",
  "side delts": "Side Delts",
  "lateral delts": "Side Delts",
  "rear delts": "Rear Delts",
  "rotator cuff": "Rotator Cuff",
  // Biceps / forearms
  brachialis: "Brachialis",
  grip: "Forearms",
  // Legs
  glutes: "Glutes",
  gluteus: "Glutes",
  hamstrings: "Hamstrings",
  hams: "Hamstrings",
  quads: "Quads",
  quadriceps: "Quads",
  calves: "Calves",
  calf: "Calves",
  "hip abductors": "Hip Abductors",
  hips: "Legs",
  adductors: "Legs",
  // Cardio
  "cardiovascular system": "Cardio",
  cardiovascular: "Cardio",
  conditioning: "Cardio",
  // PT (rehab)
  "ankle pt": "Ankle PT",
  "knee pt": "Knee PT",
  "shoulder pt": "Shoulder PT",
};

function coarseOf(label: string): CoarseGroup | null {
  if (COARSE_SET.has(label)) return label as CoarseGroup;
  return SPECIFIC_TO_COARSE[label] ?? null;
}

/**
 * Resolve one raw muscle string to its canonical label (a coarse group or a
 * known specific) plus that label's coarse group. Case- and whitespace-
 * insensitive. Returns null for an unmatched string (caller quarantines it).
 */
export function resolveMuscle(
  raw: string,
): { label: string; coarse: CoarseGroup } | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  const label = SYNONYMS[key] ?? CANONICAL_BY_KEY.get(key) ?? null;
  if (!label) return null;
  const coarse = coarseOf(label);
  return coarse ? { label, coarse } : null;
}

/**
 * Normalize an exercise's raw muscle tags to canonical labels (specific-
 * preserving), de-duped, order preserved. Unmatched strings are dropped
 * (quarantined). This is what the write path + migration store.
 */
export function normalizeMuscleGroups(raw: string[]): string[] {
  const out: string[] = [];
  for (const m of raw) {
    const r = resolveMuscle(m);
    if (r && !out.includes(r.label)) out.push(r.label);
  }
  return out;
}

/** Strings that don't resolve - for the migration's quarantine report. */
export function unmatchedMuscles(raw: string[]): string[] {
  return raw.filter((m) => m.trim() && !resolveMuscle(m));
}

/**
 * The coarse groups an exercise belongs to, in fixed coarse order. Used for the
 * picker filter, Settings, and the Insights volume rollup.
 */
export function coarseGroupsOf(raw: string[]): CoarseGroup[] {
  const set = new Set<CoarseGroup>();
  for (const m of raw) {
    const r = resolveMuscle(m);
    if (r) set.add(r.coarse);
  }
  return COARSE_MUSCLE_GROUPS.filter((c) => set.has(c));
}

/**
 * Group an exercise's tags by coarse (fixed order) with their specifics, for the
 * nested "Coarse (spec, spec)" subtitle. A coarse group present only via itself
 * (no specifics) yields an empty specifics array.
 */
export function nestedMuscleGroups(
  raw: string[],
): Array<{ coarse: CoarseGroup; specifics: string[] }> {
  const byCoarse = new Map<CoarseGroup, string[]>();
  for (const m of raw) {
    const r = resolveMuscle(m);
    if (!r) continue;
    if (!byCoarse.has(r.coarse)) byCoarse.set(r.coarse, []);
    if (r.label !== r.coarse) {
      const list = byCoarse.get(r.coarse)!;
      if (!list.includes(r.label)) list.push(r.label);
    }
  }
  return COARSE_MUSCLE_GROUPS.filter((c) => byCoarse.has(c)).map((c) => ({
    coarse: c,
    specifics: byCoarse.get(c)!,
  }));
}

/** Plain nested subtitle string, e.g. "Legs (Glutes, Hamstrings) · Chest". */
export function muscleSubtitle(raw: string[]): string {
  return nestedMuscleGroups(raw)
    .map(({ coarse, specifics }) =>
      specifics.length ? `${coarse} (${specifics.join(", ")})` : coarse,
    )
    .join(" · ");
}

/** True if the tag list resolves to (rolls up to) the given coarse group. */
export function matchesCoarse(raw: string[], coarse: CoarseGroup): boolean {
  return coarseGroupsOf(raw).includes(coarse);
}

/**
 * The controlled muscle vocabulary as a prompt-ready string, e.g.
 * "Chest; Back (Lats, Upper Back, ...); Shoulders (Front Delts, ...); ...".
 * Injected into the FitBot prompts so the model tags with canonical names
 * instead of inventing freeform ones.
 */
export function muscleVocabularyForPrompt(): string {
  return COARSE_MUSCLE_GROUPS.map((c) => {
    const s = SPECIFICS_BY_COARSE[c];
    return s.length ? `${c} (${s.join(", ")})` : c;
  }).join("; ");
}
