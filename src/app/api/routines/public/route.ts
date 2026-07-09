import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { routines, routineEntries } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Public routine library: everyone's routines marked `isPublic`, EXCLUDING the
// caller's own (those already appear under "My Routines"). View/start only - the
// [id] GET + [id]/start routes already allow a non-owner to read + start a
// public routine (start schedules workouts for the caller, not the owner). Same
// compact per-routine `entries` projection as GET /api/routines so the cards can
// render the M-S week-schedule strip without shipping the exercises jsonb.
export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(routines)
    .where(and(eq(routines.isPublic, true), ne(routines.userId, user.id)));
  if (rows.length === 0) return rows;

  const ids = rows.map((r) => r.id);
  const entries = await db
    .select({
      id: routineEntries.id,
      routineId: routineEntries.routineId,
      dayIndex: routineEntries.dayIndex,
      workoutName: routineEntries.workoutName,
      workoutTemplateId: routineEntries.workoutTemplateId,
    })
    .from(routineEntries)
    .where(inArray(routineEntries.routineId, ids));

  const byRoutine = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = byRoutine.get(e.routineId);
    if (arr) arr.push(e);
    else byRoutine.set(e.routineId, [e]);
  }
  return rows.map((r) => ({ ...r, entries: byRoutine.get(r.id) ?? [] }));
});
