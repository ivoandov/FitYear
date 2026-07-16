import { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { routineInstances, scheduledWorkouts } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const [instance] = await db
    .select()
    .from(routineInstances)
    .where(
      and(eq(routineInstances.id, id), eq(routineInstances.userId, user.id)),
    )
    .limit(1);

  if (!instance) throw new ApiError(404, "Routine instance not found");

  const linkedScheduled = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.routineInstanceId, id));

  return { ...instance, scheduledWorkouts: linkedScheduled };
});

// Soft-cancel (and any status change). Cancelling marks the instance
// "cancelled" - which hides it from the active list - and drops the
// not-yet-due scheduled workouts (today onward) so they leave the user's
// plan, while KEEPING the instance and any already-completed sessions as
// history. Past scheduled rows are left intact.
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: unknown };
  const status = typeof body.status === "string" ? body.status : undefined;

  const [instance] = await db
    .select()
    .from(routineInstances)
    .where(
      and(eq(routineInstances.id, id), eq(routineInstances.userId, user.id)),
    )
    .limit(1);

  if (!instance) throw new ApiError(404, "Routine instance not found");

  if (status === "cancelled") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    await db
      .delete(scheduledWorkouts)
      .where(
        and(
          eq(scheduledWorkouts.routineInstanceId, id),
          gte(scheduledWorkouts.date, todayStart),
        ),
      );
  }

  const [updated] = await db
    .update(routineInstances)
    .set({ status: status ?? instance.status })
    .where(eq(routineInstances.id, id))
    .returning();

  return updated;
});

export const DELETE = handle(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const [instance] = await db
    .select()
    .from(routineInstances)
    .where(
      and(eq(routineInstances.id, id), eq(routineInstances.userId, user.id)),
    )
    .limit(1);

  if (!instance) throw new ApiError(404, "Routine instance not found");

  await db
    .delete(scheduledWorkouts)
    .where(eq(scheduledWorkouts.routineInstanceId, id));
  await db.delete(routineInstances).where(eq(routineInstances.id, id));

  return { success: true };
});
