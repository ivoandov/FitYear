import { NextRequest } from "next/server";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  routines,
  routineEntries,
  routineInstances,
  scheduledWorkouts,
} from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  deleteCalendarEvent,
  getSelectedCalendarId,
  isCalendarConnected,
} from "@/lib/calendar";

type Ctx = { params: Promise<{ id: string }> };

const PostSchema = z.object({
  /**
   * What to do with sessions whose routine day no longer exists. Defaults to
   * KEEPING them, which is the behaviour this route has always had and the
   * safer half of the choice: an unwanted session can be skipped, a deleted
   * one cannot be recovered.
   */
  removeOrphaned: z.boolean().optional(),
});

type Pending = {
  id: string;
  routineDayIndex: number | null;
  routineInstanceId: string | null;
  calendarEventId: string | null;
};

/**
 * Split a running program's upcoming sessions against the routine as it is NOW.
 *
 * `updatable` still has a matching entry, so it takes the edit. `orphaned` is a
 * session whose day the edit removed - "make it 4 days instead of 5" leaves one
 * of these per remaining week. A session with no `routineDayIndex` is neither:
 * nothing links it back to a routine day, so there is no entry to update it
 * from and no basis for calling it orphaned.
 */
function splitPending(pending: Pending[], entryDays: Set<number>) {
  const updatable: Pending[] = [];
  const orphaned: Pending[] = [];
  for (const row of pending) {
    if (row.routineDayIndex == null) continue;
    if (entryDays.has(row.routineDayIndex)) updatable.push(row);
    else orphaned.push(row);
  }
  return { updatable, orphaned };
}

type Entry = typeof routineEntries.$inferSelect;

async function loadState(
  routineId: string,
  userId: string,
): Promise<{ entryByDay: Map<number, Entry>; pending: Pending[] }> {
  const [routine] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, routineId), eq(routines.userId, userId)))
    .limit(1);
  if (!routine) throw new ApiError(404, "Routine not found");

  const activeInstances = await db
    .select({ id: routineInstances.id })
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.routineId, routineId),
        eq(routineInstances.userId, userId),
        eq(routineInstances.status, "active"),
      ),
    );
  if (activeInstances.length === 0) {
    return { entryByDay: new Map<number, Entry>(), pending: [] };
  }

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, routineId));
  const entryByDay = new Map(entries.map((e) => [e.dayIndex, e]));

  // Start of today, so a session scheduled later today still updates.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const pending = await db
    .select({
      id: scheduledWorkouts.id,
      routineDayIndex: scheduledWorkouts.routineDayIndex,
      routineInstanceId: scheduledWorkouts.routineInstanceId,
      calendarEventId: scheduledWorkouts.calendarEventId,
    })
    .from(scheduledWorkouts)
    .where(
      and(
        eq(scheduledWorkouts.userId, userId),
        inArray(
          scheduledWorkouts.routineInstanceId,
          activeInstances.map((i) => i.id),
        ),
        gte(scheduledWorkouts.date, todayStart),
      ),
    );

  return { entryByDay, pending };
}

/**
 * What a re-sync WOULD do, so the confirm dialog can ask the right question.
 *
 * The removed-days case has no safe default - keeping a dropped day's sessions
 * clutters the calendar, deleting them throws away a session the user may have
 * planned around - so the UI asks, and only when there is something to ask
 * about. That needs the counts before anything is written.
 */
export const GET = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const { entryByDay, pending } = await loadState(id, user.id);
  const { updatable, orphaned } = splitPending(pending, new Set(entryByDay.keys()));

  return {
    updatableCount: updatable.length,
    orphanedCount: orphaned.length,
    orphanedDays: [
      ...new Set(orphaned.map((r) => r.routineDayIndex as number)),
    ].sort((a, b) => a - b),
  };
});

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
 * edit REMOVED are kept unless the caller asks for them to go, because the
 * right answer depends on why the day was dropped and only the user knows that.
 */
export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  // Callers predating the orphan choice send no body at all, and an empty body
  // is not valid JSON - so read it as text and only parse what is there.
  const raw = await request.text();
  const body = raw ? PostSchema.parse(JSON.parse(raw)) : {};

  const { entryByDay, pending } = await loadState(id, user.id);
  if (pending.length === 0) {
    return { ok: true, updatedCount: 0, removedCount: 0 };
  }

  const { updatable, orphaned } = splitPending(pending, new Set(entryByDay.keys()));
  const toRemove = body.removeOrphaned ? orphaned : [];

  // One transaction: a partial re-sync would leave the program half on the old
  // plan and half on the new one, which is worse than not running at all.
  await db.transaction(async (tx) => {
    for (const row of updatable) {
      const entry = entryByDay.get(row.routineDayIndex as number);
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
    }

    if (toRemove.length > 0) {
      await tx.delete(scheduledWorkouts).where(
        and(
          eq(scheduledWorkouts.userId, user.id),
          inArray(
            scheduledWorkouts.id,
            toRemove.map((r) => r.id),
          ),
        ),
      );

      // `total_workouts` is the PLANNED session count and it is the denominator
      // of every program-progress readout (Routines, the Home goals strip, the
      // tracker's completion check). Deleting sessions without decrementing it
      // leaves a program that can never reach 100%.
      const removedPerInstance = new Map<string, number>();
      for (const row of toRemove) {
        if (!row.routineInstanceId) continue;
        removedPerInstance.set(
          row.routineInstanceId,
          (removedPerInstance.get(row.routineInstanceId) ?? 0) + 1,
        );
      }
      for (const [instanceId, n] of removedPerInstance) {
        await tx
          .update(routineInstances)
          .set({
            totalWorkouts: sql`greatest(${routineInstances.totalWorkouts} - ${n}, 0)`,
          })
          .where(
            and(
              eq(routineInstances.id, instanceId),
              eq(routineInstances.userId, user.id),
            ),
          );
      }
    }
  });

  // Calendar cleanup is best-effort and deliberately OUTSIDE the transaction:
  // it is a network call to Google, and a failure there must not roll back a
  // schedule change the user already confirmed. Routine start does not create
  // events (only a manual reschedule does), so most rows have nothing to clear.
  const withEvents = toRemove.filter((r) => r.calendarEventId);
  if (withEvents.length > 0 && (await isCalendarConnected(user.id))) {
    const calendarId = await getSelectedCalendarId(user.id);
    for (const row of withEvents) {
      try {
        await deleteCalendarEvent(
          user.id,
          row.calendarEventId as string,
          calendarId,
        );
      } catch (e) {
        console.error("[update-active-instances] calendar delete failed", e);
      }
    }
  }

  return {
    ok: true,
    updatedCount: updatable.length,
    removedCount: toRemove.length,
  };
});
