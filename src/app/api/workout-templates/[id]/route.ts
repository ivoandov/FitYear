import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  workoutTemplates,
  routineEntries,
  routines,
  insertWorkoutTemplateSchema,
} from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

async function ownTemplate(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(workoutTemplates)
    .where(eq(workoutTemplates.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "Template not found");
  if (row.userId !== userId) throw new ApiError(403, "Access denied");
  return row;
}

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await ownTemplate(id, user.id);
  const body = insertWorkoutTemplateSchema.partial().parse(await request.json());
  const [updated] = await db
    .update(workoutTemplates)
    .set(body)
    .where(eq(workoutTemplates.id, id))
    .returning();
  return updated;
});

export const DELETE = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await ownTemplate(id, user.id);

  // Block delete if any routine uses this template
  const inUse = await db
    .select({ name: routines.name })
    .from(routineEntries)
    .innerJoin(routines, eq(routineEntries.routineId, routines.id))
    .where(
      and(
        eq(routineEntries.workoutTemplateId, id),
        eq(routines.userId, user.id),
      ),
    );

  if (inUse.length > 0) {
    const routineNames = inUse.map((r) => r.name);
    throw new ApiError(409, "template_in_use", {
      message: `This workout is used by the following routines: ${routineNames.join(", ")}. Remove it from those routines first before deleting.`,
      routineNames,
    });
  }

  await db.delete(workoutTemplates).where(eq(workoutTemplates.id, id));
  return new Response(null, { status: 204 });
});
