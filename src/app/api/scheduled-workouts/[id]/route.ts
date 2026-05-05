import { NextRequest } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { scheduledWorkouts } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

const PutSchema = z.object({
  name: z.string().min(1).optional(),
  date: z.string().optional(),
  localDate: z.string().optional(),
  exercises: z.unknown().optional(),
  templateId: z.string().nullable().optional(),
  routineInstanceId: z.string().nullable().optional(),
  routineDayIndex: z.number().int().nullable().optional(),
});

async function ownScheduled(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "Workout not found");
  if (row.userId !== userId) throw new ApiError(403, "Access denied");
  return row;
}

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownScheduled(id, user.id);
  const body = PutSchema.parse(await request.json());

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.exercises !== undefined) update.exercises = body.exercises;
  if (body.templateId !== undefined) update.templateId = body.templateId;
  if (body.routineInstanceId !== undefined)
    update.routineInstanceId = body.routineInstanceId;
  if (body.routineDayIndex !== undefined)
    update.routineDayIndex = body.routineDayIndex;
  if (body.localDate) {
    update.date = new Date(`${body.localDate}T12:00:00Z`);
  } else if (body.date) {
    update.date = new Date(body.date);
  }

  // If name changed, propagate to sibling rows in the same routine/template
  // (preserves the original "rename future occurrences" behavior).
  if (body.name && body.name !== existing.name) {
    if (existing.routineInstanceId) {
      await db
        .update(scheduledWorkouts)
        .set({ name: body.name })
        .where(
          and(
            eq(scheduledWorkouts.routineInstanceId, existing.routineInstanceId),
            eq(scheduledWorkouts.name, existing.name),
            ne(scheduledWorkouts.id, id),
          ),
        );
    } else if (existing.templateId) {
      await db
        .update(scheduledWorkouts)
        .set({ name: body.name })
        .where(
          and(
            eq(scheduledWorkouts.templateId, existing.templateId),
            eq(scheduledWorkouts.name, existing.name),
            sql`${scheduledWorkouts.date} >= NOW()`,
            ne(scheduledWorkouts.id, id),
          ),
        );
    }
  }

  const [updated] = await db
    .update(scheduledWorkouts)
    .set(update)
    .where(eq(scheduledWorkouts.id, id))
    .returning();
  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await ownScheduled(id, user.id);
  await db.delete(scheduledWorkouts).where(eq(scheduledWorkouts.id, id));
  return new Response(null, { status: 204 });
});
