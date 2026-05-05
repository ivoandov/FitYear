import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  workoutTemplates,
  insertWorkoutTemplateSchema,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(workoutTemplates)
    .where(eq(workoutTemplates.userId, user.id));
  return rows;
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = insertWorkoutTemplateSchema.parse(await request.json());
  const [created] = await db
    .insert(workoutTemplates)
    .values({ ...body, userId: user.id })
    .returning();
  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
