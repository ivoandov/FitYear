import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Cross-lift estimated-1RM trend: for the user's most-trained lifts, the weekly
// best Epley 1RM (weight_lbs * (1 + reps/30)) over the last N weeks, aggregated
// in SQL from the normalized tables. Assisted lifts are excluded (1RM is
// meaningless when "weight" is counter-assistance, same rule as records). The
// weeks axis is a zero-filled generate_series so every lift shares one x-axis;
// a lift with no session in a given week gets a null point (the line bridges the
// gap). Weights returned in lbs (DB units); the client converts.
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const weeks = Math.min(
    26,
    Math.max(4, Number(request.nextUrl.searchParams.get("weeks") ?? "12")),
  );
  const limit = Math.min(
    6,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "5")),
  );

  // 1. Canonical Monday-start week axis (matches date_trunc('week')).
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
  const axisRows = unwrap<{ week_start: string }>(axisResult);
  const axis = axisRows.map((r) => r.week_start);

  // 2. Weekly best e1RM for the top-N most-trained (by completed-set count) lifts.
  const dataResult = await db.execute(sql`
    with lift_sets as (
      select
        we.exercise_id as exercise_id,
        we.name_snapshot as name,
        date_trunc('week', cw.completed_at)::timestamp as week_start,
        cw.completed_at as completed_at,
        ws.weight_lbs * (1 + ws.reps::float8 / 30) as e1rm
      from completed_workouts cw
      join workout_exercises we on we.completed_workout_id = cw.id
      join workout_sets ws on ws.workout_exercise_id = we.id
      where cw.user_id = ${user.id}
        and coalesce(we.is_assisted, false) = false
        and ws.completed = true
        and ws.weight_lbs > 0
        and ws.reps > 0
        and cw.completed_at >= date_trunc('week', now()::timestamp) - ((${weeks}::int - 1) * interval '1 week')
    ),
    top_lifts as (
      select exercise_id
      from lift_sets
      group by exercise_id
      order by count(*) desc, max(completed_at) desc
      limit ${limit}
    )
    select
      s.exercise_id as exercise_id,
      (array_agg(s.name order by s.completed_at desc))[1] as name,
      to_char(s.week_start, 'YYYY-MM-DD') as week_start,
      max(s.e1rm)::float8 as e1rm_lbs
    from lift_sets s
    join top_lifts t on t.exercise_id = s.exercise_id
    group by s.exercise_id, s.week_start
    order by s.exercise_id, s.week_start
  `);
  const dataRows = unwrap<{
    exercise_id: string;
    name: string | null;
    week_start: string;
    e1rm_lbs: number;
  }>(dataResult);

  // Pivot flat rows into one series per lift, aligned to the shared week axis.
  const byLift = new Map<
    string,
    { name: string | null; byWeek: Map<string, number> }
  >();
  for (const r of dataRows) {
    let lift = byLift.get(r.exercise_id);
    if (!lift) {
      lift = { name: r.name, byWeek: new Map() };
      byLift.set(r.exercise_id, lift);
    }
    lift.byWeek.set(r.week_start, Number(r.e1rm_lbs));
  }

  const lifts = [...byLift.entries()].map(([exerciseId, lift]) => ({
    exerciseId,
    name: lift.name ?? "Exercise",
    e1rmLbs: axis.map((w) => lift.byWeek.get(w) ?? null),
  }));

  return { weeks: axis, lifts };
});

function unwrap<T>(result: unknown): T[] {
  return (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as T[];
}
