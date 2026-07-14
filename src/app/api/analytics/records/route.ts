import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// All-time records per exercise, computed in SQL from the normalized tables
// (server-side PR detection over the source of truth, so it stays correct even
// if the client-side in-workout PR write was ever missed). For normal lifts:
// best (heaviest) weight, best set volume (weight*reps), best est-1RM (Epley,
// weight*(1+reps/30)). For assisted lifts (lower weight = harder, since "weight"
// is counter-assistance): best = the LOWEST positive weight; volume + 1RM are
// omitted (meaningless there, same rule as detectPRs). Ordered most-recently
// trained first. Weights returned in lbs; the client converts.
export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const limit = Math.min(
    24,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "8")),
  );

  const result = await db.execute(sql`
    select
      we.exercise_id as exercise_id,
      (array_agg(we.name_snapshot order by cw.completed_at desc))[1] as name,
      bool_or(coalesce(we.is_assisted, false)) as is_assisted,
      max(ws.weight_lbs)::float8 as max_weight_lbs,
      min(ws.weight_lbs)::float8 as min_weight_lbs,
      max(ws.weight_lbs * ws.reps)::float8 as best_volume_lbs,
      max(ws.weight_lbs * (1 + ws.reps::float8 / 30))::float8 as best_1rm_lbs,
      to_char(max(cw.completed_at), 'YYYY-MM-DD') as last_performed
    from workout_exercises we
    join workout_sets ws on ws.workout_exercise_id = we.id
    join completed_workouts cw on cw.id = we.completed_workout_id
    where cw.user_id = ${user.id}
      and ws.completed = true
      and ws.weight_lbs > 0
      and ws.reps > 0
    group by we.exercise_id
    order by max(cw.completed_at) desc
    limit ${limit}
  `);

  const rows = (
    Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])
  ) as Array<{
    exercise_id: string;
    name: string | null;
    is_assisted: boolean;
    max_weight_lbs: number;
    min_weight_lbs: number;
    best_volume_lbs: number;
    best_1rm_lbs: number;
    last_performed: string;
  }>;

  return rows.map((r) => {
    const assisted = !!r.is_assisted;
    return {
      exerciseId: r.exercise_id,
      name: r.name,
      isAssisted: assisted,
      bestWeightLbs: assisted ? Number(r.min_weight_lbs) : Number(r.max_weight_lbs),
      best1RMLbs: assisted ? null : Number(r.best_1rm_lbs),
      bestVolumeLbs: assisted ? null : Number(r.best_volume_lbs),
      lastPerformed: r.last_performed,
    };
  });
});
