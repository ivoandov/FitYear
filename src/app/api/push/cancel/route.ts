import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { restNotifications } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

const PostSchema = z.object({ restId: z.string().min(1).max(100) });

/**
 * Called when a rest ends with the app open (skipped, or counted down in the
 * foreground where the local notification already fired). The sleeping workflow
 * re-reads this status when it wakes, so cancelling here is enough - the
 * workflow itself does not need to be torn down.
 *
 * Writes a TOMBSTONE rather than a plain UPDATE: skipping a rest within a
 * second of starting it means this request can beat the schedule request, and
 * an UPDATE would match zero rows and silently leave the alert armed. The
 * schedule route refuses to move a cancelled row back to pending, so cancel
 * wins regardless of which request lands first.
 */
export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  await db
    .insert(restNotifications)
    .values({
      id: body.restId,
      userId: user.id,
      status: "cancelled",
      fireAt: new Date(),
    })
    .onConflictDoUpdate({
      target: restNotifications.id,
      set: { status: "cancelled" },
      // Scoped to the caller so one user cannot cancel another's alert.
      setWhere: eq(restNotifications.userId, user.id),
    });

  return { ok: true };
});
