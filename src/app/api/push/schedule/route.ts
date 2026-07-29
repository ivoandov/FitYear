import { NextRequest } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { restNotifications } from "@/lib/db/schema";
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

  const fireAt = new Date(Date.now() + body.delaySeconds * 1000);

  // Re-arming the same rest (the timer was paused and resumed) reuses the row
  // and puts it back to pending.
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
    });

  await start(restAlertWorkflow, [body.restId, body.delaySeconds]);

  return { ok: true, fireAt: fireAt.toISOString() };
});
