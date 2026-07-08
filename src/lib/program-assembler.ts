import type {
  Skeleton,
  Program,
  Exercise,
  PhaseVariety,
  PhaseVarietyDay,
} from "@/lib/program-schema";
import {
  expandSkeleton,
  type ExpandedSkeleton,
  type ExpandedSplitDay,
} from "@/lib/program-progression";

/**
 * Program assembler — stage 3 of the segmented program builder (the thin,
 * deterministic stitch). It combines:
 *   1. the model's skeleton (split + phases),
 *   2. the deterministic per-week anchor progression (expandSkeleton), and
 *   3. the per-phase variety (accessory exercises + phase-flavored names, one
 *      LLM call per phase),
 * into the final `Program` (the unchanged save-program wire shape). Anchors
 * carry the deterministic `targetLoadLbs`; accessories don't (they fall back to
 * Track's last-recorded prefill). No model call happens here — this runs in the
 * client after all phases are built. See FITBOT_TECH_SPEC.md section 2.4.
 */

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

// Map whatever the model wrote for a day ("Mon", "monday", "Tues") to a full
// weekday name so it lines up with WEEKDAYS + save-program's DAY_INDEX_BY_NAME.
// Returns null for anything unrecognized (those days get placed on the first
// free weekday instead of being dropped).
const WEEKDAY_ALIASES: Record<string, (typeof WEEKDAYS)[number]> = {
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tues: "Tuesday",
  tuesday: "Tuesday",
  wed: "Wednesday",
  weds: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thur: "Thursday",
  thurs: "Thursday",
  thursday: "Thursday",
  fri: "Friday",
  friday: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
  sun: "Sunday",
  sunday: "Sunday",
};

function normalizeWeekday(s: string): (typeof WEEKDAYS)[number] | null {
  return WEEKDAY_ALIASES[s.trim().toLowerCase()] ?? null;
}

// Pick the phase that owns a given (1-indexed) week. Falls back gracefully when
// the model's phase ranges don't perfectly tile 1..durationWeeks: clamp to the
// last phase whose startWeek is on/before the week (or phase 0 for early weeks).
function phaseIndexForWeek(skeleton: Skeleton, week: number): number {
  const exact = skeleton.phases.findIndex(
    (p) => week >= p.startWeek && week <= p.endWeek,
  );
  if (exact >= 0) return exact;
  let best = 0;
  for (let i = 0; i < skeleton.phases.length; i++) {
    if (skeleton.phases[i].startWeek <= week) best = i;
  }
  return best;
}

export interface AssembleInput {
  skeleton: Skeleton;
  // Per-phase variety, index-aligned to skeleton.phases. A null/undefined entry
  // (a phase that wasn't built) yields anchors-only training days for that
  // phase's weeks, with the split day's dayLabel as the workout name.
  variety: Array<PhaseVariety | null | undefined>;
  // Optional precomputed expansion (else computed here). Handy for tests.
  expanded?: ExpandedSkeleton;
}

export function assembleProgram({
  skeleton,
  variety,
  expanded,
}: AssembleInput): Program {
  const exp = expanded ?? expandSkeleton(skeleton);

  // Assign each split day to a weekday once (the split is constant across
  // weeks). Recognized weekdays win their slot; unrecognized or colliding days
  // spill onto the first free weekday so nothing is silently dropped.
  const assigned = new Map<(typeof WEEKDAYS)[number], ExpandedSplitDay>();
  const leftover: ExpandedSplitDay[] = [];
  for (const day of exp.split) {
    const wd = normalizeWeekday(day.dayOfWeek);
    if (wd && !assigned.has(wd)) assigned.set(wd, day);
    else leftover.push(day);
  }
  for (const day of leftover) {
    const free = WEEKDAYS.find((d) => !assigned.has(d));
    if (free) assigned.set(free, day);
  }

  const weeks = [];
  for (let w = 1; w <= skeleton.durationWeeks; w++) {
    const pIdx = phaseIndexForWeek(skeleton, w);
    const phaseVariety = variety[pIdx] ?? null;
    const varByLabel = new Map<string, PhaseVarietyDay>();
    if (phaseVariety) {
      for (const d of phaseVariety.days) varByLabel.set(d.dayLabel, d);
    }

    const days = WEEKDAYS.map((dow) => {
      const split = assigned.get(dow);
      if (!split) {
        return {
          dayOfWeek: dow,
          workoutName: "Rest",
          isRest: true,
          exercises: [] as Exercise[],
        };
      }
      const v = varByLabel.get(split.dayLabel);

      const anchors: Exercise[] = split.anchors.map((a) => {
        const p = a.weekly[w - 1];
        const ex: Exercise = {
          name: a.name,
          sets: p.sets,
          reps: p.reps,
          rest: a.restSeconds,
          notes: p.isDeload
            ? "Deload week — ease off the load and focus on clean reps."
            : "",
        };
        // Only weight-based anchors with a real load surface a target.
        if (a.exerciseType === "weight_reps" && p.loadLbs > 0) {
          ex.targetLoadLbs = p.loadLbs;
        }
        return ex;
      });

      const accessories: Exercise[] = (v?.accessories ?? []).map((acc) => ({
        name: acc.name,
        sets: acc.sets,
        reps: acc.reps,
        rest: acc.rest,
        notes: acc.notes ?? "",
      }));

      return {
        dayOfWeek: dow,
        workoutName: v?.workoutName?.trim() || split.dayLabel,
        isRest: false,
        exercises: [...anchors, ...accessories],
      };
    });

    weeks.push({ weekNum: w, days });
  }

  return { name: exp.name, weeks };
}
