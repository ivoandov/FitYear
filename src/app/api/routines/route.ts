import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { routines, routineEntries } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(routines)
    .where(eq(routines.userId, user.id));
  if (rows.length === 0) return rows;

  // Attach a COMPACT per-routine entries projection (no exercises jsonb) so the
  // Routines list can render each card's M–S week-schedule strip + day names
  // without shipping every program's full exercise payload. One extra query.
  const ids = rows.map((r) => r.id);
  const entries = await db
    .select({
      id: routineEntries.id,
      routineId: routineEntries.routineId,
      dayIndex: routineEntries.dayIndex,
      workoutName: routineEntries.workoutName,
      workoutTemplateId: routineEntries.workoutTemplateId,
    })
    .from(routineEntries)
    .where(inArray(routineEntries.routineId, ids));

  const byRoutine = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = byRoutine.get(e.routineId);
    if (arr) arr.push(e);
    else byRoutine.set(e.routineId, [e]);
  }
  return rows.map((r) => ({ ...r, entries: byRoutine.get(r.id) ?? [] }));
});

const EntrySchema = z.object({
  dayIndex: z.number().int(),
  workoutTemplateId: z.string().nullable().optional(),
  workoutName: z.string().nullable().optional(),
  exercises: z.unknown().optional(),
});

const PostSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  defaultDurationDays: z.number().int().positive().optional(),
  isPublic: z.boolean().optional(),
  entries: z.array(EntrySchema).optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  const [routine] = await db
    .insert(routines)
    .values({
      userId: user.id,
      name: body.name,
      description: body.description ?? null,
      defaultDurationDays: body.defaultDurationDays ?? 7,
      isPublic: body.isPublic ?? false,
    })
    .returning();

  if (body.entries?.length) {
    await db.insert(routineEntries).values(
      body.entries.map((e) => ({
        routineId: routine.id,
        dayIndex: e.dayIndex,
        workoutTemplateId: e.workoutTemplateId ?? null,
        workoutName: e.workoutName ?? null,
        exercises: e.exercises ?? null,
      })),
    );
  }

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, routine.id));

  return new Response(JSON.stringify({ ...routine, entries }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
