import { NextRequest, NextResponse } from "next/server";
import { handleCalendarCallback } from "@/lib/calendar";
import { requireUser } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const settingsUrl = new URL("/settings", url);

  if (error) {
    settingsUrl.searchParams.set("calendar_error", error);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code) {
    settingsUrl.searchParams.set("calendar_error", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const { user } = await requireUser();
    await handleCalendarCallback(code, user.id);
    settingsUrl.searchParams.set("calendar_connected", "true");
    return NextResponse.redirect(settingsUrl);
  } catch (e) {
    settingsUrl.searchParams.set(
      "calendar_error",
      (e as Error).message || "unknown_error",
    );
    return NextResponse.redirect(settingsUrl);
  }
}
