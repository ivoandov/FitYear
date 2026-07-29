import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { restNotifications } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

const PostSchema = z.object({ restId: z.string().min(1).max(100) });

/**
 * Called when a rest ends with the app open (skipped, or counted down in the
 * foreground where the local notification already fired). The sleeping workflow
 * checks this status when it wakes, so cancelling here is enough - the workflow
 * itself does not need to be torn down.
 */
export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  await db
    .update(restNotifications)
    .set({ status: "cancelled" })
    // Scoped to the caller so one user cannot cancel another's alert.
    .where(
      and(
        eq(restNotifications.id, body.restId),
        eq(restNotifications.userId, user.id),
        eq(restNotifications.status, "pending"),
      ),
    );

  return { ok: true };
});
