import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { completedWorkouts, userSettings } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { deleteCalendarEvent, isCalendarConnected } from "@/lib/calendar";
import { writeNormalizedRows } from "@/lib/db/normalized-workout";

type Ctx = { params: Promise<{ id: string }> };

const PutSchema = z.object({
  name: z.string().min(1).optional(),
  exercises: z.unknown().optional(),
  completedAt: z.string().optional(),
});

async function ownCompleted(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(completedWorkouts)
    .where(eq(completedWorkouts.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "Workout not found");
  if (row.userId !== userId) throw new ApiError(403, "Access denied");
  return row;
}

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await ownCompleted(id, user.id);
  const body = PutSchema.parse(await request.json());

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.completedAt !== undefined) update.completedAt = new Date(body.completedAt);

  // Phase 4d: update the row and re-sync its normalized exercises/sets in ONE
  // transaction (the normalized tables are the sole store). A set-write failure
  // rolls the whole edit back rather than leaving the workout half-updated.
  const updated = await db.transaction(async (tx) => {
    let row;
    if (Object.keys(update).length > 0) {
      [row] = await tx
        .update(completedWorkouts)
        .set(update)
        .where(eq(completedWorkouts.id, id))
        .returning();
    } else {
      [row] = await tx
        .select()
        .from(completedWorkouts)
        .where(eq(completedWorkouts.id, id))
        .limit(1);
    }
    if (body.exercises !== undefined) {
      await writeNormalizedRows(tx, id, body.exercises);
    }
    return row;
  });

  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownCompleted(id, user.id);

  if (existing.calendarEventId && (await isCalendarConnected(user.id))) {
    const [s] = await db
      .select({ id: userSettings.selectedCalendarId })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1);
    await deleteCalendarEvent(user.id, existing.calendarEventId, s?.id ?? undefined);
  }

  await db.delete(completedWorkouts).where(eq(completedWorkouts.id, id));
  return new Response(null, { status: 204 });
});
