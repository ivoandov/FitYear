import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
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
