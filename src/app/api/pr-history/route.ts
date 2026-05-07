import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { prHistory, exercises } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? "5"),
    50,
  );

  const rows = await db
    .select({
      id: prHistory.id,
      exerciseId: prHistory.exerciseId,
      exerciseName: exercises.name,
      workoutId: prHistory.workoutId,
      prType: prHistory.prType,
      newValue: prHistory.newValue,
      previousValue: prHistory.previousValue,
      achievedAt: prHistory.achievedAt,
    })
    .from(prHistory)
    .leftJoin(exercises, eq(prHistory.exerciseId, exercises.id))
    .where(eq(prHistory.userId, user.id))
    .orderBy(desc(prHistory.achievedAt))
    .limit(limit);

  return rows;
});

const PostSchema = z.object({
  exerciseId: z.string().min(1),
  workoutId: z.string().min(1),
  prType: z.enum(["weight", "volume"]),
  newValue: z.number(),
  previousValue: z.number().nullable().optional(),
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());
  const [created] = await db
    .insert(prHistory)
    .values({
      userId: user.id,
      exerciseId: body.exerciseId,
      workoutId: body.workoutId,
      prType: body.prType,
      newValue: body.newValue,
      previousValue: body.previousValue ?? null,
    })
    .returning();
  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
