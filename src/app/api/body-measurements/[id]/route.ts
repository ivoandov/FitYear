import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bodyMeasurements } from "@/lib/db/schema";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  // Scoped to the caller: an id from a browser is not proof of ownership.
  const deleted = await db
    .delete(bodyMeasurements)
    .where(and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, user.id)))
    .returning();
  if (!deleted.length) throw new ApiError(404, "Not found");
  return Response.json({ ok: true });
});
