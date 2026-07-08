import { round1 } from "@/lib/units";
import type {
  AnchorProgression,
  AnchorLift,
  Skeleton,
} from "@/lib/program-schema";

/**
 * Deterministic progression expansion for the segmented program builder.
 *
 * The model designs the macrocycle (split, phases, anchor lifts + structured
 * progression rules) in the skeleton call; the actual week-to-week loads are
 * computed HERE, in code, not by the model. The model is unreliable at
 * consistent arithmetic across 15+ weeks, so doing it deterministically
 * guarantees the "add weight and make progress" backbone is exactly right (the
 * ~65% of the program that's progression). Per-phase variety exercises (the
 * ~35%) are authored by separate LLM calls and layered on top.
 *
 * v1 scheme is linear: sets/reps stay fixed, load climbs by `incrementLbs` each
 * NON-deload week, and progression carries across deloads (a deload is lighter
 * but the next working week resumes climbing from where the block left off).
 */

export interface WeekPrescription {
  week: number; // 1-indexed
  sets: number;
  reps: string;
  loadLbs: number;
  isDeload: boolean;
}

export interface DeloadConfig {
  durationWeeks: number;
  deloadWeeks: number[]; // 1-indexed
  deloadLoadFactor: number; // e.g. 0.9 = 10% lighter
}

/** Expand one anchor lift's linear load progression across every week. */
export function expandAnchorLift(
  progression: AnchorProgression,
  cfg: DeloadConfig,
): WeekPrescription[] {
  const deload = new Set(cfg.deloadWeeks);
  const out: WeekPrescription[] = [];
  let step = 0; // non-deload weeks seen so far
  let lastBase = progression.startLoadLbs; // unrounded load of the last working week
  for (let w = 1; w <= cfg.durationWeeks; w++) {
    if (deload.has(w)) {
      out.push({
        week: w,
        sets: progression.sets,
        reps: progression.reps,
        loadLbs: round1(lastBase * cfg.deloadLoadFactor),
        isDeload: true,
      });
    } else {
      const base = progression.startLoadLbs + progression.incrementLbs * step;
      lastBase = base;
      out.push({
        week: w,
        sets: progression.sets,
        reps: progression.reps,
        loadLbs: round1(base),
        isDeload: false,
      });
      step++;
    }
  }
  return out;
}

export interface ExpandedAnchor extends Omit<AnchorLift, "progression"> {
  weekly: WeekPrescription[];
}

export interface ExpandedSplitDay {
  dayLabel: string;
  dayOfWeek: string;
  muscleGroups: string[];
  anchors: ExpandedAnchor[];
}

export interface ExpandedSkeleton {
  name: string;
  durationWeeks: number;
  split: ExpandedSplitDay[];
}

/**
 * Expand the whole skeleton: every anchor lift in every split day gets its
 * per-week prescription. The assembler (later, thin) walks weeks x split days
 * and interleaves the stage-2 variety exercises with these anchor prescriptions
 * to produce the final program.
 */
export function expandSkeleton(skeleton: Skeleton): ExpandedSkeleton {
  const cfg: DeloadConfig = {
    durationWeeks: skeleton.durationWeeks,
    deloadWeeks: skeleton.deloadWeeks,
    deloadLoadFactor: skeleton.deloadLoadFactor,
  };
  return {
    name: skeleton.name,
    durationWeeks: skeleton.durationWeeks,
    split: skeleton.split.map((day) => ({
      dayLabel: day.dayLabel,
      dayOfWeek: day.dayOfWeek,
      muscleGroups: day.muscleGroups,
      anchors: day.anchorLifts.map((lift) => {
        const { progression, ...meta } = lift;
        return { ...meta, weekly: expandAnchorLift(progression, cfg) };
      }),
    })),
  };
}
