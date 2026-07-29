import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";
import { expandMuscleLabel, resolveMuscle } from "@/lib/muscle-groups";

// Volume-by-muscle over time: weekly training volume (sum of weight_lbs * reps
// over completed sets) split by muscle group, last N weeks. Muscle identity
// comes from workout_exercises.muscle_groups_snapshot (the inline snapshot taken
// at log time - the historical source of truth, unaffected by later exercise
// renames/deletes). That column is now uniformly a jsonb ARRAY: the ~470 legacy
// rows that stored a double-encoded jsonb STRING ('["Legs"]') were normalized to
// real arrays by scripts/normalize-muscle-snapshots.ts (2026-07-14), and the
// write path only ever stores arrays. The `array`-guard below keeps the unnest
// crash-proof regardless (a non-array would contribute nothing rather than throw
// 22023 "cannot extract elements from a scalar"). The weeks axis is a zero-filled
// generate_series so the stacked bars read as a continuous timeline. Volume
// returned in lbs; the client converts + stacks.
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  // Bucket days/weeks in the VIEWER's zone, not UTC (see lib/api/timezone).
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));
  const weeks = Math.min(
    26,
    Math.max(4, Number(request.nextUrl.searchParams.get("weeks") ?? "12")),
  );

  const axisResult = await db.execute(sql`
    with anchor as (select date_trunc('week', (now() at time zone ${tz})) as this_week)
    select to_char(gs::timestamp, 'YYYY-MM-DD') as week_start
    from generate_series(
      (select this_week from anchor) - ((${weeks}::int - 1) * interval '1 week'),
      (select this_week from anchor),
      interval '1 week'
    ) as gs
    order by 1
  `);
  const axis = unwrap<{ week_start: string }>(axisResult).map((r) => r.week_start);

  // One row per exercise instance, carrying its whole tag array. This used to
  // fan out with jsonb_array_elements_text and sum per tag, which multiplied a
  // set's volume by the number of its tags that share a coarse group: a lunge
  // tagged Quads + Glutes + Hamstrings reported 3x its real Legs volume.
  const dataResult = await db.execute(sql`
    select
      to_char(date_trunc('week', (cw.completed_at at time zone 'UTC' at time zone ${tz}))::timestamp, 'YYYY-MM-DD') as week_start,
      we.id as exercise_row_id,
      case when jsonb_typeof(we.muscle_groups_snapshot) = 'array'
           then we.muscle_groups_snapshot else '[]'::jsonb end as muscles,
      sum(ws.weight_lbs * ws.reps)::float8 as volume_lbs
    from completed_workouts cw
    join workout_exercises we on we.completed_workout_id = cw.id
    join workout_sets ws on ws.workout_exercise_id = we.id
    where cw.user_id = ${user.id}
      and ws.completed = true
      and ws.weight_lbs is not null
      and ws.reps is not null
      and (cw.completed_at at time zone 'UTC' at time zone ${tz}) >= date_trunc('week', (now() at time zone ${tz})) - ((${weeks}::int - 1) * interval '1 week')
    group by 1, 2, 3
    order by 1
  `);
  const dataRows = unwrap<{
    week_start: string;
    exercise_row_id: string;
    muscles: unknown;
    volume_lbs: number;
  }>(dataResult);

  // Pivot into one zero-filled series per COARSE muscle group (Design 2026-07-16:
  // the volume cards stay coarse - ~9 clean cards, not 25). Each exercise credits
  // a coarse group ONCE, however many of its tags roll up there. Unresolved tags
  // are dropped.
  const byCoarse = new Map<string, Map<string, number>>();
  for (const r of dataRows) {
    const tags = Array.isArray(r.muscles) ? (r.muscles as string[]) : [];
    const coarseGroups = new Set<string>();
    for (const tag of tags) {
      if (typeof tag !== "string") continue;
      for (const part of expandMuscleLabel(tag)) {
        const resolved = resolveMuscle(part);
        if (resolved) coarseGroups.add(resolved.coarse);
      }
    }
    for (const coarse of coarseGroups) {
      let m = byCoarse.get(coarse);
      if (!m) {
        m = new Map();
        byCoarse.set(coarse, m);
      }
      m.set(r.week_start, (m.get(r.week_start) ?? 0) + Number(r.volume_lbs));
    }
  }

  const muscles = [...byCoarse.entries()]
    .map(([muscle, byWeek]) => {
      const volumeLbs = axis.map((w) => byWeek.get(w) ?? 0);
      const total = volumeLbs.reduce((a, b) => a + b, 0);
      return { muscle, volumeLbs, totalLbs: total };
    })
    .sort((a, b) => b.totalLbs - a.totalLbs);

  return { weeks: axis, muscles };
});

function unwrap<T>(result: unknown): T[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as T[];
}
