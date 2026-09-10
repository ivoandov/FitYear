import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";
import {
  COARSE_MUSCLE_GROUPS,
  expandMuscleLabel,
  resolveMuscle,
  type CoarseGroup,
} from "@/lib/muscle-groups";
import { rankGroups, balanceHeadline, type GroupActivity } from "@/lib/muscle-balance";

/**
 * What this user has and has not been training lately, per coarse muscle group.
 *
 * The read model behind FitBot's coaching: the app has always known which
 * muscles were worked and when, and has never once used it to say anything.
 *
 * Counted in SETS, not volume - pounds are not comparable across muscle groups,
 * so a volume ranking reports Biceps as permanently neglected and Legs as
 * permanently fine. And credited ONCE per coarse group per exercise, which is
 * the same rule the volume charts had to learn: a lunge tagged Quads + Glutes +
 * Hamstrings is one Legs exercise, not three.
 *
 * Muscle identity comes from the per-workout SNAPSHOT, so a later rename or
 * retag cannot rewrite what you did in March.
 */
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));
  // The window the user's own "normal" is measured over. Long enough to survive
  // a holiday, short enough that a training style from a year ago is not still
  // setting the bar.
  const BASELINE_DAYS = 84;

  const result = await db.execute(sql`
    select
      we.id as exercise_row_id,
      case when jsonb_typeof(we.muscle_groups_snapshot) = 'array'
           then we.muscle_groups_snapshot else '[]'::jsonb end as muscles,
      count(*)::int as sets,
      max(cw.completed_at) as last_at,
      (extract(epoch from (
        (now() at time zone ${tz})::date
        - (max(cw.completed_at) at time zone 'UTC' at time zone ${tz})::date
      )) / 86400)::int as days_since
    from completed_workouts cw
    join workout_exercises we on we.completed_workout_id = cw.id
    join workout_sets ws on ws.workout_exercise_id = we.id
    where cw.user_id = ${user.id}
      and ws.completed = true
      and cw.completed_at >= now() - (${BASELINE_DAYS}::int * interval '1 day')
    group by 1, 2
  `);

  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<{
    exercise_row_id: string;
    muscles: unknown;
    sets: number;
    last_at: string | Date;
    days_since: number;
  }>;

  // Per coarse group: total sets in the window, sets in the last 7 days, and
  // the most recent day it was trained.
  const totalSets = new Map<CoarseGroup, number>();
  const sets7 = new Map<CoarseGroup, number>();
  const minDays = new Map<CoarseGroup, number>();

  for (const row of rows) {
    const raw = Array.isArray(row.muscles) ? (row.muscles as unknown[]) : [];
    // One exercise credits a coarse group ONCE however many of its tags roll up
    // into that group.
    const groups = new Set<CoarseGroup>();
    for (const tag of raw) {
      for (const label of expandMuscleLabel(String(tag))) {
        // resolveMuscle returns { label, coarse } and quarantines anything it
        // does not recognise, which is what keeps junk tags out of the ranking.
        const resolved = resolveMuscle(label);
        if (resolved) groups.add(resolved.coarse);
      }
    }
    for (const g of groups) {
      totalSets.set(g, (totalSets.get(g) ?? 0) + row.sets);
      if (row.days_since <= 7) sets7.set(g, (sets7.get(g) ?? 0) + row.sets);
      const cur = minDays.get(g);
      if (cur === undefined || row.days_since < cur) minDays.set(g, row.days_since);
    }
  }

  const activity: GroupActivity[] = COARSE_MUSCLE_GROUPS.map((group) => ({
    group,
    daysSince: minDays.get(group) ?? null,
    sets7: sets7.get(group) ?? 0,
    baselineWeekly: ((totalSets.get(group) ?? 0) / BASELINE_DAYS) * 7,
  }));

  const verdicts = rankGroups(activity);
  return Response.json({
    baselineDays: BASELINE_DAYS,
    headline: balanceHeadline(verdicts),
    groups: verdicts,
  });
});
