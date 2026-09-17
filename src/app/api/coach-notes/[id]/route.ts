import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { deleteCoachNote, updateCoachNote } from "@/lib/api/coach-notes";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Correct or drop one thing FitBot believes about you.
 *
 * Both handlers scope on the caller's id inside the helper: an id arriving from
 * a browser is not proof of ownership, and these rows hold the most personal
 * text in the product.
 */

export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = (await request.json()) as Record<string, unknown>;

  const result = await updateCoachNote(user.id, id, {
    // Only fields the caller actually named. Passing undefined through would
    // let a request that edits the wording blank the expiry it never mentioned.
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.content !== undefined ? { content: body.content } : {}),
    ...(body.expiresOn !== undefined ? { expiresOn: body.expiresOn } : {}),
  });

  if (!result.ok) {
    if (result.reason === "not_found") throw new ApiError(404, "Not found");
    throw new ApiError(
      400,
      result.reason === "invalid" ? result.message : "Could not update that note.",
    );
  }
  return Response.json(result.note);
});

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const result = await deleteCoachNote(user.id, id);
  if (!result.ok) throw new ApiError(404, "Not found");
  return Response.json({ ok: true });
});
