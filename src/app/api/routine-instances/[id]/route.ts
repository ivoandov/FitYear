import { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { routineInstances, scheduledWorkouts } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { isUniqueViolation } from "@/lib/api/pg-errors";

type Ctx = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  status: z.enum(["active", "cancelled", "completed"]).optional(),
});

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

  // userId-scoped like PATCH/DELETE below: `routineInstanceId` is unvalidated
  // client input with no FK, so without the scope another user's rows pointing
  // at this instance id would be served inside this response.
  const linkedScheduled = await db
    .select()
    .from(scheduledWorkouts)
    .where(
      and(
        eq(scheduledWorkouts.routineInstanceId, id),
        eq(scheduledWorkouts.userId, user.id),
      ),
    );

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
  // Whitelisted: a free-form string could write a status nothing matches
  // (hiding the instance from both the active and cancelled views) or revive a
  // cancelled instance straight into the partial unique index as a raw 500.
  const body = PatchSchema.parse(await req.json().catch(() => ({})));
  const status = body.status;

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
    // userId-scoped: routineInstanceId is unvalidated client input on
    // scheduled workouts (no FK), so without it another user's rows pointing
    // at this instance id would be deleted too.
    await db
      .delete(scheduledWorkouts)
      .where(
        and(
          eq(scheduledWorkouts.routineInstanceId, id),
          eq(scheduledWorkouts.userId, user.id),
          gte(scheduledWorkouts.date, todayStart),
        ),
      );
  }

  try {
    const [updated] = await db
      .update(routineInstances)
      .set({ status: status ?? instance.status })
      .where(eq(routineInstances.id, id))
      .returning();

    return updated;
  } catch (e) {
    // Reviving a cancelled instance while another is already active hits the
    // partial unique index; that is a conflict the caller can act on, not a
    // server fault.
    if (isUniqueViolation(e)) {
      throw new ApiError(409, "This routine is already running.");
    }
    throw e;
  }
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
    .where(
      and(
        eq(scheduledWorkouts.routineInstanceId, id),
        eq(scheduledWorkouts.userId, user.id),
      ),
    );
  await db.delete(routineInstances).where(eq(routineInstances.id, id));

  return { success: true };
});
