import { NextRequest } from "next/server";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";
import { listCoachDocuments, saveCoachDocument } from "@/lib/api/coach-documents";
import { MAX_DOCUMENT_LENGTH, MAX_DOCUMENTS } from "@/lib/coach-documents";
import { localDateKeyInZone } from "@/lib/date";

/**
 * The documents somebody has given their coach, and the screen that manages
 * them.
 *
 * The listing never returns the text - a library of reports would be a large
 * payload on a settings screen that mostly wants titles. Reading one is its own
 * request.
 */

export const GET = handle(async () => {
  const { user } = await requireUser();
  return Response.json(await listCoachDocuments(user.id));
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));
  const body = (await request.json()) as Record<string, unknown>;

  const result = await saveCoachDocument(user.id, {
    title: typeof body.title === "string" ? body.title : null,
    content: typeof body.content === "string" ? body.content : "",
    source: "user",
    today: localDateKeyInZone(new Date(), tz),
  });

  if (!result.ok) {
    if (result.reason === "full") {
      throw new ApiError(409, `You can keep ${MAX_DOCUMENTS} documents. Delete one first.`);
    }
    if (result.reason === "too_long") {
      throw new ApiError(
        400,
        `That is longer than ${MAX_DOCUMENT_LENGTH.toLocaleString()} characters. Save it in parts.`,
      );
    }
    throw new ApiError(400, "There was nothing to save.");
  }

  return Response.json(result.document, { status: 201 });
});
