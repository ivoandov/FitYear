import {
  COARSE_MUSCLE_GROUPS,
  SPECIFICS_BY_COARSE,
  normalizeMuscleGroups,
  type CoarseGroup,
} from "@/lib/muscle-groups";

/**
 * Which regions of an anatomical body map a workout trained, and how hard.
 *
 * Ivo, 2026-09-18, said yes to a muscle map after AscendAPI's paid Muscle
 * Visualizer was rejected (its terms forbid keeping the images). The diagram
 * is drawn client-side by the MIT package `react-muscle-highlighter`; this
 * module is the part with opinions, kept pure so they are tested.
 *
 * Three rules, each from a gotcha this app already paid for:
 *  - SPECIFIC beats COARSE. An exercise tagged Legs + Quads trained the quads;
 *    lighting every leg region because "Legs" is also on it would say a leg
 *    extension worked the calves.
 *  - An exercise credits each region ONCE, however many of its tags land
 *    there (the 2026-07-21 rule: a lunge tagged three leg muscles must not
 *    triple anything).
 *  - Measured in SETS, never volume, and only completed ones (2026-09-09 and
 *    2026-07-21). Pounds are not comparable across muscles.
 *
 * Cardio and PT are not muscles and draw nothing.
 */

/** The package's region names that FitYear can light. */
export type MapRegion =
  | "abs"
  | "adductors"
  | "biceps"
  | "calves"
  | "chest"
  | "deltoids"
  | "forearm"
  | "gluteal"
  | "hamstring"
  | "lower-back"
  | "obliques"
  | "quadriceps"
  | "trapezius"
  | "triceps"
  | "upper-back";

/** Every canonical label (coarse or specific) to the regions it covers. */
const REGIONS_BY_LABEL: Record<string, MapRegion[]> = {
  Chest: ["chest"],
  Back: ["upper-back", "trapezius", "lower-back"],
  Lats: ["upper-back"],
  "Upper Back": ["upper-back", "trapezius"],
  "Lower Back": ["lower-back"],
  Traps: ["trapezius"],
  Shoulders: ["deltoids"],
  "Front Delts": ["deltoids"],
  "Side Delts": ["deltoids"],
  "Rear Delts": ["deltoids"],
  "Rotator Cuff": ["deltoids"],
  Biceps: ["biceps"],
  Brachialis: ["biceps"],
  Triceps: ["triceps"],
  Forearms: ["forearm"],
  "Abs/Core": ["abs", "obliques"],
  Obliques: ["obliques"],
  Legs: ["quadriceps", "hamstring", "gluteal", "calves", "adductors"],
  Glutes: ["gluteal"],
  Hamstrings: ["hamstring"],
  Quads: ["quadriceps"],
  Calves: ["calves"],
  "Hip Abductors": ["gluteal"],
};

const COARSE_OF_SPECIFIC = new Map<string, CoarseGroup>(
  COARSE_MUSCLE_GROUPS.flatMap((c) => SPECIFICS_BY_COARSE[c].map((s) => [s, c] as const)),
);

/** The regions one exercise trained, from its muscle tags. */
export function regionsFor(muscleGroups: string[]): Set<MapRegion> {
  const labels = normalizeMuscleGroups(muscleGroups);
  // A coarse tag is only a fallback: if the exercise also names a specific
  // muscle inside that group, the specific is the truth.
  const specifiedGroups = new Set(
    labels.map((l) => COARSE_OF_SPECIFIC.get(l)).filter((c): c is CoarseGroup => !!c),
  );
  const regions = new Set<MapRegion>();
  for (const label of labels) {
    if (specifiedGroups.has(label as CoarseGroup)) continue;
    for (const r of REGIONS_BY_LABEL[label] ?? []) regions.add(r);
  }
  return regions;
}

export type RegionLoad = { slug: MapRegion; sets: number; intensity: 1 | 2 | 3 };

/**
 * Sets per region for a workout, with a 1-3 intensity relative to the most
 * trained region. Relative on purpose: the map answers "what did this session
 * hit", and a fixed scale would render a short session as uniformly faint.
 */
export function muscleMapLoads(
  exercises: Array<{ muscleGroups: string[]; completedSets: number }>,
): RegionLoad[] {
  const sets = new Map<MapRegion, number>();
  for (const ex of exercises) {
    if (ex.completedSets <= 0) continue;
    for (const r of regionsFor(ex.muscleGroups)) {
      sets.set(r, (sets.get(r) ?? 0) + ex.completedSets);
    }
  }
  const max = Math.max(0, ...sets.values());
  return [...sets.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([slug, n]) => ({
      slug,
      sets: n,
      intensity: Math.min(3, Math.max(1, Math.ceil((3 * n) / max))) as 1 | 2 | 3,
    }));
}
