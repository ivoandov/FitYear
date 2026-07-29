import { NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { pushSubscriptions, restNotifications } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { restAlertWorkflow } from "@/workflows/rest-alert";

const PostSchema = z.object({
  restId: z.string().min(1).max(100),
  // Bounded: a rest is a rest, not a reminder for tomorrow.
  delaySeconds: z.number().int().min(5).max(3600),
  exerciseName: z.string().max(120).optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  // No device to deliver to (permission granted but never subscribed, or the
  // subscription was pruned) - don't create a row or a sleeping workflow run
  // that can only ever no-op.
  const [subscription] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id))
    .limit(1);
  if (!subscription) return { ok: true, scheduled: false };

  const fireAt = new Date(Date.now() + body.delaySeconds * 1000);

  await db
    .insert(restNotifications)
    .values({
      id: body.restId,
      userId: user.id,
      status: "pending",
      exerciseName: body.exerciseName ?? null,
      fireAt,
    })
    .onConflictDoUpdate({
      target: restNotifications.id,
      set: { status: "pending", fireAt, exerciseName: body.exerciseName ?? null },
      // Owner-scoped (a client-supplied id must never write another user's
      // row), and never resurrects an alert that was already cancelled - the
      // cancel request can legitimately arrive first when a rest is skipped
      // immediately after starting.
      setWhere: and(
        eq(restNotifications.userId, user.id),
        ne(restNotifications.status, "cancelled"),
      ),
    });

  // Only sleep on it if this call actually armed the alert.
  const [row] = await db
    .select({ status: restNotifications.status, userId: restNotifications.userId })
    .from(restNotifications)
    .where(eq(restNotifications.id, body.restId))
    .limit(1);
  if (!row || row.userId !== user.id || row.status !== "pending") {
    return { ok: true, scheduled: false };
  }

  await start(restAlertWorkflow, [body.restId, body.delaySeconds]);

  return { ok: true, scheduled: true, fireAt: fireAt.toISOString() };
});
