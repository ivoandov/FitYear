import { NextRequest } from "next/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  routines,
  routineEntries,
  routineInstances,
  scheduledWorkouts,
} from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Re-sync a running program's remaining scheduled workouts after its routine
 * was edited.
 *
 * The Routines page has always prompted for this ("Only future workouts that
 * haven't been completed yet will be updated"), but the route was never ported
 * from the Replit app, so every confirm 404'd and the scheduled rows diverged
 * permanently from the routine_entries they came from, with no way back.
 *
 * Matching is by `routineDayIndex`, the same key routines/[id]/start writes, so
 * an entry that changed exercises or name updates its day in place. Days the
 * edit removed are left alone rather than deleted: dropping a user's upcoming
 * session is not what "update the remaining workouts" promises.
 */
export const POST = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const [routine] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, id), eq(routines.userId, user.id)))
    .limit(1);
  if (!routine) throw new ApiError(404, "Routine not found");

  const activeInstances = await db
    .select({ id: routineInstances.id })
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.routineId, id),
        eq(routineInstances.userId, user.id),
        eq(routineInstances.status, "active"),
      ),
    );
  if (activeInstances.length === 0) return { ok: true, updatedCount: 0 };

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, id));
  const entryByDay = new Map(entries.map((e) => [e.dayIndex, e]));

  // Start of today, so a session scheduled later today still updates.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const pending = await db
    .select({
      id: scheduledWorkouts.id,
      routineDayIndex: scheduledWorkouts.routineDayIndex,
    })
    .from(scheduledWorkouts)
    .where(
      and(
        eq(scheduledWorkouts.userId, user.id),
        inArray(
          scheduledWorkouts.routineInstanceId,
          activeInstances.map((i) => i.id),
        ),
        gte(scheduledWorkouts.date, todayStart),
      ),
    );

  let updatedCount = 0;
  // One transaction: a partial re-sync would leave the program half on the old
  // plan and half on the new one, which is worse than not running at all.
  await db.transaction(async (tx) => {
    for (const row of pending) {
      if (row.routineDayIndex == null) continue;
      const entry = entryByDay.get(row.routineDayIndex);
      if (!entry) continue;
      await tx
        .update(scheduledWorkouts)
        .set({
          exercises: entry.exercises,
          ...(entry.workoutName ? { name: entry.workoutName } : {}),
        })
        .where(
          and(
            eq(scheduledWorkouts.id, row.id),
            eq(scheduledWorkouts.userId, user.id),
          ),
        );
      updatedCount++;
    }
  });

  return { ok: true, updatedCount };
});
