import { NextRequest } from "next/server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  routines,
  routineEntries,
  routineInstances,
  scheduledWorkouts,
} from "@/lib/db/schema";
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

  // One transaction: the entries are replaced with a delete-then-insert, so a
  // failure between them (a dropped pooler connection, an oversized program)
  // used to leave the routine with ZERO entries, unrecoverably.
  const updated = await db.transaction(async (tx) => {
    const [row] =
      Object.keys(update).length > 0
        ? await tx.update(routines).set(update).where(eq(routines.id, id)).returning()
        : await tx.select().from(routines).where(eq(routines.id, id)).limit(1);

    if (body.entries) {
      await tx.delete(routineEntries).where(eq(routineEntries.routineId, id));
      if (body.entries.length) {
        await tx.insert(routineEntries).values(
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
    return row;
  });

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

  // routine_instances.routine_id is a plain varchar with NO foreign key, so the
  // routine's cascade reaches routine_entries but never the instances. Deleting
  // a routine mid-program used to leave an ACTIVE instance behind (prod had
  // one) whose future scheduled workouts stayed on the calendar pointing at a
  // routine that no longer exists. Wind the program down in the same
  // transaction: cancel its instances and drop their not-yet-due sessions,
  // keeping completed history exactly like the soft-cancel path does.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  await db.transaction(async (tx) => {
    const instances = await tx
      .select({ id: routineInstances.id })
      .from(routineInstances)
      .where(
        and(
          eq(routineInstances.routineId, id),
          eq(routineInstances.userId, user.id),
        ),
      );
    if (instances.length > 0) {
      const ids = instances.map((i) => i.id);
      await tx
        .delete(scheduledWorkouts)
        .where(
          and(
            eq(scheduledWorkouts.userId, user.id),
            inArray(scheduledWorkouts.routineInstanceId, ids),
            gte(scheduledWorkouts.date, todayStart),
          ),
        );
      await tx
        .update(routineInstances)
        .set({ status: "cancelled" })
        .where(
          and(
            inArray(routineInstances.id, ids),
            eq(routineInstances.userId, user.id),
            eq(routineInstances.status, "active"),
          ),
        );
    }
    await tx.delete(routines).where(eq(routines.id, id));
  });

  return { success: true };
});
