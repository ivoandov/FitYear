import { NextResponse } from "next/server";
import { getCalendarAuthUrl } from "@/lib/calendar";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const authUrl = getCalendarAuthUrl(user.id);
  return NextResponse.redirect(authUrl);
});
