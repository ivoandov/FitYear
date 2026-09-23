import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { deleteCoachDocument, getCoachDocument } from "@/lib/api/coach-documents";

/** One document in full, and deleting it. Both scoped to the owner. */
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const doc = await getCoachDocument(user.id, id);
  if (!doc) throw new ApiError(404, "Document not found");
  return Response.json(doc);
});

export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  // A 404 rather than a silent success: deleting somebody else's id is not a
  // thing that quietly works.
  if (!(await deleteCoachDocument(user.id, id))) throw new ApiError(404, "Document not found");
  return Response.json({ success: true });
});
