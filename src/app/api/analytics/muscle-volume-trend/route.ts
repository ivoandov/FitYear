import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Volume-by-muscle over time: weekly training volume (sum of weight_lbs * reps
// over completed sets) split by muscle group, last N weeks. Muscle identity
// comes from workout_exercises.muscle_groups_snapshot (the inline snapshot taken
// at log time - the historical source of truth, unaffected by later exercise
// renames/deletes). That column holds TWO shapes across history: a genuine jsonb
// array (["Legs"]) on newer rows, and a jsonb STRING whose text is a JSON array
// ('["Legs"]', double-encoded) on the ~470 older rows - the app's read path
// tolerates both, so the SQL decode must too, or jsonb_array_elements_text throws
// "cannot extract elements from a scalar". The CASE below normalizes both (and a
// bare-string name) to a jsonb array before unnesting. The weeks axis is a
// zero-filled generate_series so the stacked bars read as a continuous timeline.
// Volume returned in lbs; the client converts + stacks.
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const weeks = Math.min(
    26,
    Math.max(4, Number(request.nextUrl.searchParams.get("weeks") ?? "12")),
  );

  const axisResult = await db.execute(sql`
    with anchor as (select date_trunc('week', now()::timestamp) as this_week)
    select to_char(gs::timestamp, 'YYYY-MM-DD') as week_start
    from generate_series(
      (select this_week from anchor) - ((${weeks}::int - 1) * interval '1 week'),
      (select this_week from anchor),
      interval '1 week'
    ) as gs
    order by 1
  `);
  const axis = unwrap<{ week_start: string }>(axisResult).map((r) => r.week_start);

  const dataResult = await db.execute(sql`
    select
      to_char(date_trunc('week', cw.completed_at)::timestamp, 'YYYY-MM-DD') as week_start,
      muscle,
      sum(ws.weight_lbs * ws.reps)::float8 as volume_lbs
    from completed_workouts cw
    join workout_exercises we on we.completed_workout_id = cw.id
    join workout_sets ws on ws.workout_exercise_id = we.id
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(we.muscle_groups_snapshot) = 'array' then we.muscle_groups_snapshot
        when jsonb_typeof(we.muscle_groups_snapshot) = 'string'
             and left(we.muscle_groups_snapshot #>> '{}', 1) = '[' then (we.muscle_groups_snapshot #>> '{}')::jsonb
        when jsonb_typeof(we.muscle_groups_snapshot) = 'string' then jsonb_build_array(we.muscle_groups_snapshot #>> '{}')
        else '[]'::jsonb
      end
    ) as muscle
    where cw.user_id = ${user.id}
      and ws.completed = true
      and ws.weight_lbs is not null
      and ws.reps is not null
      and cw.completed_at >= date_trunc('week', now()::timestamp) - ((${weeks}::int - 1) * interval '1 week')
    group by 1, 2
    order by 1
  `);
  const dataRows = unwrap<{
    week_start: string;
    muscle: string;
    volume_lbs: number;
  }>(dataResult);

  // Pivot into one zero-filled series per muscle, aligned to the week axis, and
  // rank muscles by total volume (the client can then cap/stack the top ones).
  const byMuscle = new Map<string, Map<string, number>>();
  for (const r of dataRows) {
    if (!r.muscle) continue;
    let m = byMuscle.get(r.muscle);
    if (!m) {
      m = new Map();
      byMuscle.set(r.muscle, m);
    }
    m.set(r.week_start, Number(r.volume_lbs));
  }

  const muscles = [...byMuscle.entries()]
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
