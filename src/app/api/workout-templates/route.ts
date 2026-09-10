import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  workoutTemplates,
  insertWorkoutTemplateSchema,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { loadWorkoutTemplates } from "@/lib/api/home-payload";

export const GET = handle(async () => {
  const { user } = await requireUser();
  // Shared with the server-rendered Home payload so the two cannot drift.
  return loadWorkoutTemplates(user.id);
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
