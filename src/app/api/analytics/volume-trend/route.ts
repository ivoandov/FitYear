import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Weekly total training volume (sum of weight_lbs * reps over COMPLETED sets)
// for the last N weeks, aggregated in SQL from the normalized workout tables
// (workout_exercises / workout_sets) and zero-filled via generate_series so an
// empty week renders a gap bar rather than vanishing. Monday-start weeks
// (Postgres date_trunc('week')). Everything is cast to plain `timestamp` to match
// how completed_at is stored (no tz), so the week buckets line up with the join.
// Volume is returned in lbs (DB units); the client converts to the user's unit.
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const weeks = Math.min(
    26,
    Math.max(4, Number(request.nextUrl.searchParams.get("weeks") ?? "12")),
  );

  const result = await db.execute(sql`
    with anchor as (
      select date_trunc('week', now()::timestamp) as this_week
    ),
    weeks as (
      select generate_series(
        (select this_week from anchor) - ((${weeks}::int - 1) * interval '1 week'),
        (select this_week from anchor),
        interval '1 week'
      )::timestamp as week_start
    ),
    vol as (
      select
        date_trunc('week', cw.completed_at)::timestamp as week_start,
        sum(ws.weight_lbs * ws.reps) as volume_lbs,
        count(ws.id) as sets,
        count(distinct cw.id) as workouts
      from completed_workouts cw
      join workout_exercises we on we.completed_workout_id = cw.id
      join workout_sets ws on ws.workout_exercise_id = we.id
      where cw.user_id = ${user.id}
        and ws.completed = true
        and ws.weight_lbs is not null
        and ws.reps is not null
        and cw.completed_at >= (select this_week from anchor) - ((${weeks}::int - 1) * interval '1 week')
      group by 1
    )
    select
      to_char(w.week_start, 'YYYY-MM-DD') as week_start,
      coalesce(v.volume_lbs, 0)::float8 as volume_lbs,
      coalesce(v.sets, 0)::int as sets,
      coalesce(v.workouts, 0)::int as workouts
    from weeks w
    left join vol v on v.week_start = w.week_start
    order by w.week_start
  `);

  const rows = (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Array<{
    week_start: string;
    volume_lbs: number;
    sets: number;
    workouts: number;
  }>;

  return rows.map((r) => ({
    weekStart: r.week_start,
    volumeLbs: Number(r.volume_lbs),
    sets: Number(r.sets),
    workouts: Number(r.workouts),
  }));
});
