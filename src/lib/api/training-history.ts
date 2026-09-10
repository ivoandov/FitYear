import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  COARSE_MUSCLE_GROUPS,
  expandMuscleLabel,
  resolveMuscle,
  type CoarseGroup,
} from "@/lib/muscle-groups";
import { rankGroups, type GroupActivity, type GroupVerdict } from "@/lib/muscle-balance";

/**
 * What this user has actually been doing, for anything that needs to know.
 *
 * Lives here rather than in the route because THREE callers need the same
 * answer and must not disagree: the muscle-balance endpoint behind Home's
 * nudge, the prompt block that finally tells FitBot what the user has trained,
 * and the routine editor. Three copies of this query would drift within a
 * month, and the failure would be silent - a coach citing different numbers
 * than the card that sent you to it.
 */

/** The window a user's own "normal" is measured over. */
export const BASELINE_DAYS = 84;

export interface ExerciseUsage {
  name: string;
  group: CoarseGroup;
  sets: number;
}

export interface TrainingHistory {
  verdicts: GroupVerdict[];
  /** The user's most-logged exercises per coarse group, most-used first. */
  favoritesByGroup: Map<CoarseGroup, ExerciseUsage[]>;
  totalWorkouts: number;
}

interface Row {
  exercise_row_id: string;
  name_snapshot: string | null;
  muscles: unknown;
  sets: number;
  days_since: number;
}

function unwrap<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as T[];
}

/** Every coarse group an exercise credits, counted ONCE however many tags roll up. */
export function groupsOf(muscles: unknown): Set<CoarseGroup> {
  const out = new Set<CoarseGroup>();
  const raw = Array.isArray(muscles) ? (muscles as unknown[]) : [];
  for (const tag of raw) {
    for (const label of expandMuscleLabel(String(tag))) {
      const resolved = resolveMuscle(label);
      if (resolved) out.add(resolved.coarse);
    }
  }
  return out;
}

export async function loadTrainingHistory(
  userId: string,
  tz: string,
): Promise<TrainingHistory> {
  const result = await db.execute(sql`
    select
      we.id as exercise_row_id,
      we.name_snapshot,
      case when jsonb_typeof(we.muscle_groups_snapshot) = 'array'
           then we.muscle_groups_snapshot else '[]'::jsonb end as muscles,
      count(*)::int as sets,
      -- date MINUS date is already a whole number of days in Postgres, not an
      -- interval, so there is nothing for extract(epoch from ...) to extract -
      -- it fails with "function pg_catalog.extract(unknown, integer) does not
      -- exist" and 500s the whole route.
      ((now() at time zone ${tz})::date
        - (max(cw.completed_at) at time zone 'UTC' at time zone ${tz})::date)::int as days_since
    from completed_workouts cw
    join workout_exercises we on we.completed_workout_id = cw.id
    join workout_sets ws on ws.workout_exercise_id = we.id
    where cw.user_id = ${userId}
      and ws.completed = true
      and cw.completed_at >= now() - (${BASELINE_DAYS}::int * interval '1 day')
    group by 1, 2, 3
  `);
  const rows = unwrap<Row>(result);

  const totalSets = new Map<CoarseGroup, number>();
  const sets7 = new Map<CoarseGroup, number>();
  const minDays = new Map<CoarseGroup, number>();
  // name -> group -> sets, so "most used for Back" is answerable.
  const usage = new Map<string, ExerciseUsage>();
  const workoutIds = new Set<string>();

  for (const row of rows) {
    workoutIds.add(row.exercise_row_id);
    const groups = groupsOf(row.muscles);
    for (const g of groups) {
      totalSets.set(g, (totalSets.get(g) ?? 0) + row.sets);
      if (row.days_since <= 7) sets7.set(g, (sets7.get(g) ?? 0) + row.sets);
      const cur = minDays.get(g);
      if (cur === undefined || row.days_since < cur) minDays.set(g, row.days_since);

      const name = (row.name_snapshot ?? "").trim();
      if (!name) continue;
      const key = `${g}::${name}`;
      const prev = usage.get(key);
      if (prev) prev.sets += row.sets;
      else usage.set(key, { name, group: g, sets: row.sets });
    }
  }

  const activity: GroupActivity[] = COARSE_MUSCLE_GROUPS.map((group) => ({
    group,
    daysSince: minDays.get(group) ?? null,
    sets7: sets7.get(group) ?? 0,
    baselineWeekly: ((totalSets.get(group) ?? 0) / BASELINE_DAYS) * 7,
  }));

  const favoritesByGroup = new Map<CoarseGroup, ExerciseUsage[]>();
  for (const u of usage.values()) {
    const list = favoritesByGroup.get(u.group) ?? [];
    list.push(u);
    favoritesByGroup.set(u.group, list);
  }
  for (const [g, list] of favoritesByGroup) {
    list.sort((x, y) => y.sets - x.sets);
    favoritesByGroup.set(g, list.slice(0, 6));
  }

  const [countRow] = unwrap<{ n: number }>(
    await db.execute(sql`
      select count(*)::int as n from completed_workouts
      where user_id = ${userId}
        and completed_at >= now() - (${BASELINE_DAYS}::int * interval '1 day')`),
  );

  return {
    verdicts: rankGroups(activity),
    favoritesByGroup,
    totalWorkouts: countRow?.n ?? 0,
  };
}

/**
 * The history as a prompt block.
 *
 * The whole point of the coaching work: until now every AI route took a
 * description and returned a plan, with no idea whether the user had ever
 * trained. Shaped like `exerciseCatalogPromptBlock` so the routes compose them
 * the same way.
 *
 * Returns "" when there is not enough history to say anything, because a model
 * handed "you have done 2 workouts" will confidently over-fit to them.
 */
export function trainingHistoryPromptBlock(history: TrainingHistory): string {
  if (history.totalWorkouts < 4) return "";

  const lines: string[] = [];
  lines.push(
    `\nTHIS USER'S RECENT TRAINING (last ${BASELINE_DAYS} days, ${history.totalWorkouts} workouts).`,
    `Use it. Prioritise what is behind, and prefer exercises they already do.`,
    `Sets per week are THEIR OWN average, not a target - do not tell them a number is wrong.`,
  );
  for (const v of history.verdicts) {
    if (v.group === "PT") continue;
    const when =
      v.daysSince == null ? "never trained" : v.daysSince === 0 ? "trained today" : `${v.daysSince}d ago`;
    lines.push(
      `- ${v.group}: ${when}, ${v.sets7} sets in the last 7 days, usually ${v.baselineWeekly.toFixed(1)}/week [${v.status}]`,
    );
  }

  const favLines: string[] = [];
  for (const [group, list] of history.favoritesByGroup) {
    if (!list.length) continue;
    favLines.push(`- ${group}: ${list.map((u) => u.name).join(", ")}`);
  }
  if (favLines.length) {
    lines.push(`\nTHEIR MOST-USED EXERCISES PER GROUP (prefer these when adding work):`);
    lines.push(...favLines);
  }
  return lines.join("\n");
}
