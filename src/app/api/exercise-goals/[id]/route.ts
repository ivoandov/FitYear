import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { exerciseGoals, insertExerciseGoalSchema } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = insertExerciseGoalSchema
    .omit({ userId: true })
    .partial()
    .parse(await request.json());

  const [updated] = await db
    .update(exerciseGoals)
    .set(body)
    .where(and(eq(exerciseGoals.id, id), eq(exerciseGoals.userId, user.id)))
    .returning();

  if (!updated) throw new ApiError(404, "Goal not found");
  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const [deleted] = await db
    .delete(exerciseGoals)
    .where(and(eq(exerciseGoals.id, id), eq(exerciseGoals.userId, user.id)))
    .returning();
  if (!deleted) throw new ApiError(404, "Goal not found");
  return new Response(null, { status: 204 });
});
