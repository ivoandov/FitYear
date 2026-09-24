import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { routineInstances, scheduledWorkouts } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/auth";

/**
 * End a running program: the soft cancel the Routines "X" button performs.
 *
 * Marks the instance cancelled, which drops it from the active list, and removes
 * the sessions it had scheduled from today onward, keeping the instance row and
 * every session already trained as history. Lifted out of the PATCH handler on
 * 2026-09-23 so the integration door could end a program through the same code
 * the button and FitBot's `propose_end_program` use.
 *
 * userId-scoped throughout: `routineInstanceId` on a scheduled workout is
 * unvalidated client input with no foreign key, so without the scope another
 * user's rows pointing at this id would go too.
 */
export async function endProgram(input: { userId: string; instanceId: string }) {
  const { userId, instanceId } = input;
  const [instance] = await db
    .select()
    .from(routineInstances)
    .where(and(eq(routineInstances.id, instanceId), eq(routineInstances.userId, userId)))
    .limit(1);
  if (!instance) throw new ApiError(404, "Routine instance not found");

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  await db
    .delete(scheduledWorkouts)
    .where(
      and(
        eq(scheduledWorkouts.routineInstanceId, instanceId),
        eq(scheduledWorkouts.userId, userId),
        gte(scheduledWorkouts.date, todayStart),
      ),
    );

  const [updated] = await db
    .update(routineInstances)
    .set({ status: "cancelled" })
    .where(eq(routineInstances.id, instanceId))
    .returning();
  return updated;
}
