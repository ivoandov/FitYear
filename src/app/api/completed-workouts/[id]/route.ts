import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { completedWorkouts } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

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
  if (body.exercises !== undefined) update.exercises = body.exercises;
  if (body.completedAt !== undefined) update.completedAt = new Date(body.completedAt);

  const [updated] = await db
    .update(completedWorkouts)
    .set(update)
    .where(eq(completedWorkouts.id, id))
    .returning();
  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await ownCompleted(id, user.id);
  await db.delete(completedWorkouts).where(eq(completedWorkouts.id, id));
  return new Response(null, { status: 204 });
});
