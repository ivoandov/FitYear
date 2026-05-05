import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { routines, routineEntries } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

const EntrySchema = z.object({
  dayIndex: z.number().int(),
  workoutTemplateId: z.string().nullable().optional(),
  workoutName: z.string().nullable().optional(),
  exercises: z.unknown().optional(),
});

const PutSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  defaultDurationDays: z.number().int().positive().optional(),
  isPublic: z.boolean().optional(),
  entries: z.array(EntrySchema).optional(),
});

async function ownRoutine(id: string, userId: string, requireOwner = true) {
  const [row] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, id))
    .limit(1);
  if (!row) throw new ApiError(404, "Routine not found");
  if (requireOwner && row.userId !== userId) {
    if (!row.isPublic) throw new ApiError(403, "Access denied");
  }
  return row;
}

export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const routine = await ownRoutine(id, user.id, false);
  if (routine.userId !== user.id && !routine.isPublic) {
    throw new ApiError(403, "Access denied");
  }
  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, id));
  return { ...routine, entries };
});

export const PUT = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownRoutine(id, user.id);
  if (existing.userId !== user.id) throw new ApiError(403, "Access denied");

  const body = PutSchema.parse(await request.json());
  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.defaultDurationDays !== undefined)
    update.defaultDurationDays = body.defaultDurationDays;
  if (body.isPublic !== undefined) update.isPublic = body.isPublic;

  const [updated] = await db
    .update(routines)
    .set(update)
    .where(eq(routines.id, id))
    .returning();

  if (body.entries) {
    await db.delete(routineEntries).where(eq(routineEntries.routineId, id));
    if (body.entries.length) {
      await db.insert(routineEntries).values(
        body.entries.map((e) => ({
          routineId: id,
          dayIndex: e.dayIndex,
          workoutTemplateId: e.workoutTemplateId ?? null,
          workoutName: e.workoutName ?? null,
          exercises: e.exercises ?? null,
        })),
      );
    }
  }

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, id));
  return { ...updated, entries };
});

export const DELETE = handle(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const existing = await ownRoutine(id, user.id);
  if (existing.userId !== user.id) throw new ApiError(403, "Access denied");
  await db.delete(routines).where(eq(routines.id, id));
  return { success: true };
});
