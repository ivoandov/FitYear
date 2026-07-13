import type {
  Skeleton,
  Program,
  ProgramDay,
  Exercise,
  PhaseVariety,
} from "@/lib/program-schema";
import {
  expandSkeleton,
  type ExpandedSkeleton,
} from "@/lib/program-progression";

/**
 * Program assembler — stage 3 of the segmented program builder (the thin,
 * deterministic stitch). It combines:
 *   1. the model's skeleton (the distinct workouts + the rotation cycle + phases),
 *   2. the deterministic per-week anchor progression (expandSkeleton), and
 *   3. the per-phase variety (accessory exercises + phase-flavored names, one
 *      LLM call per phase),
 * into the final `Program` — a FLAT day-by-day sequence across the whole
 * program, NOT a weekday grid. The workouts rotate on `skeleton.cycle` (each
 * entry is a workout index or -1 for a rest slot), repeated back-to-back for the
 * whole duration; the cycle is not pinned to weekdays. Each day carries its
 * absolute 1-indexed `dayIndex`, which save-program writes straight onto
 * routine_entries. Anchors carry the deterministic `targetLoadLbs`; accessories
 * don't (they fall back to Track's last-recorded prefill). No model call happens
 * here — this runs in the client after all phases are built. See
 * FITBOT_TECH_SPEC.md section 2.4.
 */

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
  // phase's weeks, with the workout's label as the workout name.
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

  const cycle = skeleton.cycle;
  const cycleLength = cycle.length;
  const durationWeeks = skeleton.durationWeeks;
  // Exact program length in days. Fall back to whole weeks for older skeletons
  // (durationDays defaults to 0) that predate the field.
  const durationDays =
    skeleton.durationDays > 0 ? skeleton.durationDays : durationWeeks * 7;

  const days: ProgramDay[] = [];
  for (let dayIndex = 1; dayIndex <= durationDays; dayIndex++) {
    const cyclePos = ((dayIndex - 1) % cycleLength + cycleLength) % cycleLength;
    const wIdx = cycle[cyclePos];

    // Rest slot (-1), or a defensive out-of-range index, becomes a rest day.
    if (wIdx < 0 || wIdx >= exp.workouts.length) {
      days.push({ dayIndex, workoutName: "Rest", isRest: true, exercises: [] });
      continue;
    }

    // Progression stays time-based: the load a workout uses depends on which
    // calendar week of the program the day falls in (clamped to the last week),
    // independent of how often the cycle repeats it.
    const week = Math.min(Math.ceil(dayIndex / 7), durationWeeks);
    const workout = exp.workouts[wIdx];
    const pIdx = phaseIndexForWeek(skeleton, week);
    const v =
      (variety[pIdx] ?? null)?.days.find((d) => d.label === workout.label) ??
      undefined;

    const anchors: Exercise[] = workout.anchors.map((a) => {
      const p = a.weekly[week - 1];
      const ex: Exercise = {
        name: a.name,
        sets: p.sets,
        reps: p.reps,
        rest: a.restSeconds,
        notes: p.isDeload
          ? "Deload week. Ease off the load and focus on clean reps."
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

    days.push({
      dayIndex,
      workoutName: v?.workoutName?.trim() || workout.label,
      isRest: false,
      exercises: [...anchors, ...accessories],
    });
  }

  return { name: exp.name, cycleLength, days };
}
