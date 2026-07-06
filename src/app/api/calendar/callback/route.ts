import { NextRequest, NextResponse } from "next/server";
import { handleCalendarCallback } from "@/lib/calendar";
import { requireUser } from "@/lib/api/auth";

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");

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
    // CSRF guard: getCalendarAuthUrl sets state = userId. Require it to match the
    // authenticated user before exchanging the code, so an attacker can't attach
    // their own Google tokens to a victim's session (login CSRF).
    if (state !== user.id) {
      settingsUrl.searchParams.set("calendar_error", "state_mismatch");
      return NextResponse.redirect(settingsUrl);
    }
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
