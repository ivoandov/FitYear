import { NextRequest } from "next/server";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";
import { createCoachNote, loadCoachNotes } from "@/lib/api/coach-notes";
import { localDateKeyInZone } from "@/lib/date";

/**
 * What FitBot remembers about you, and the screen that lets you correct it.
 *
 * These notes are written by the chat without asking permission first, which is
 * the one place FitBot writes rather than proposes. This route is the other
 * half of that bargain and the reason it is defensible: everything the coach
 * believes is listed here, and anything wrong can be edited or deleted in one
 * tap. Memory you cannot inspect is memory you cannot trust.
 *
 * A note created HERE is stamped `source: "user"`, which the chat is told not
 * to quietly rewrite. Something you stated yourself outranks something the
 * model inferred.
 */

export const GET = handle(async () => {
  const { user } = await requireUser();
  return Response.json(await loadCoachNotes(user.id));
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));
  const body = (await request.json()) as Record<string, unknown>;

  const result = await createCoachNote(
    user.id,
    {
      kind: body.kind,
      content: body.content,
      expiresOn: body.expiresOn,
      source: "user",
    },
    localDateKeyInZone(new Date(), tz),
  );

  if (!result.ok) {
    if (result.reason === "duplicate") {
      // 200 rather than 409: the caller asked for a fact to be remembered and
      // it is remembered. Nothing failed and there is nothing for them to fix.
      return Response.json({ ...result.note, duplicate: true }, { status: 200 });
    }
    if (result.reason === "full") {
      throw new ApiError(
        409,
        `FitBot is already holding ${result.limit} things about you. Remove one first.`,
      );
    }
    throw new ApiError(
      400,
      result.reason === "invalid" ? result.message : "Could not save that note.",
    );
  }

  return Response.json(result.note, { status: 201 });
});
