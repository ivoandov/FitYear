import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";

// Training consistency: per-day completed-workout count over the last N days,
// zero-filled via generate_series so the client can render a continuous calendar
// heatmap + derive streak/rate stats. Counts distinct completed_workouts per
// calendar day (a day with two sessions counts as 2). Days bucket on the plain
// completed_at::date (completed_at is stored tz-naive).
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  // Bucket days/weeks in the VIEWER's zone, not UTC (see lib/api/timezone).
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));
  const days = Math.min(
    140,
    Math.max(28, Number(request.nextUrl.searchParams.get("days")) || 84),
  );

  const result = await db.execute(sql`
    with span as (
      select
        ((now() at time zone ${tz}))::date as today,
        (((now() at time zone ${tz}))::date - (${days}::int - 1)) as first_day
    ),
    grid as (
      select generate_series(
        (select first_day from span)::timestamp,
        (select today from span)::timestamp,
        interval '1 day'
      )::date as day
    ),
    counts as (
      select (cw.completed_at at time zone 'UTC' at time zone ${tz})::date as day, count(*)::int as workouts
      from completed_workouts cw, span
      where cw.user_id = ${user.id}
        and (cw.completed_at at time zone 'UTC' at time zone ${tz})::date >= span.first_day
      group by 1
    )
    select to_char(g.day, 'YYYY-MM-DD') as day, coalesce(c.workouts, 0)::int as workouts
    from grid g
    left join counts c on c.day = g.day
    order by g.day
  `);

  const rows = (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ day: string; workouts: number }>;

  return rows.map((r) => ({ day: r.day, workouts: Number(r.workouts) }));
});
