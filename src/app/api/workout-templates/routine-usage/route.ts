import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { routineEntries, routines } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

/**
 * Which routines use each workout template: `{ [templateId]: routineName[] }`.
 *
 * Home has queried this on every load since the badge was written, and the
 * endpoint did not exist. The request fell through to `/api/workout-templates/
 * [id]` with the id "routine-usage", which has only PUT and DELETE, so it
 * answered **405** - twice, because React Query retries once. The badge that
 * tells you a template belongs to a routine has therefore never appeared, and
 * nothing surfaced it: a failed query just leaves the data undefined, and the
 * badge renders only when there IS data.
 *
 * Found by measuring Home's requests, not by anyone noticing the missing badge.
 *
 * A static segment beside `[id]` wins the route match, so adding this file is
 * what stops the fall-through.
 */
export const GET = handle(async () => {
  const { user } = await requireUser();

  // Ownership is checked on the ROUTINE and the entries are read through it:
  // routine_entries.routine_id is a plain varchar with no foreign key, so a
  // query starting from the entries could cross users.
  const rows = await db
    .select({
      templateId: routineEntries.workoutTemplateId,
      routineName: routines.name,
    })
    .from(routineEntries)
    .innerJoin(routines, eq(routines.id, routineEntries.routineId))
    .where(eq(routines.userId, user.id));

  const usage: Record<string, string[]> = {};
  for (const r of rows) {
    // A day with an INLINE workout (everything FitBot generates, everything
    // imported) has no template id and is not "usage" of anything.
    if (!r.templateId) continue;
    const list = (usage[r.templateId] ??= []);
    // One routine using a template on several days is still one routine.
    if (!list.includes(r.routineName)) list.push(r.routineName);
  }
  return usage;
});
