import { NextRequest, NextResponse } from "next/server";
import { handleCalendarCallback } from "@/lib/calendar";
import { requireUser } from "@/lib/api/auth";
import { verifyCalendarState } from "@/lib/calendar-state";

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
    // The SIGNED state is the identity, not the session cookie. Google sends the
    // user back here through whichever browser showed the consent screen; from
    // the native shell that is the system browser, which has none of the app's
    // cookies. The signature proves this state was minted by this server, for
    // that user, within the last ten minutes, and has not been edited - which
    // is the same CSRF guarantee the old `state === user.id` check gave, minus
    // the cookie dependency.
    const verified = verifyCalendarState(state);
    if (!verified.ok) {
      settingsUrl.searchParams.set("calendar_error", `state_${verified.reason}`);
      return NextResponse.redirect(settingsUrl);
    }

    // Belt and braces for the browser case: when a session IS present it must
    // be the same user the state names, so a signed state cannot be used from
    // somebody else's logged-in browser.
    const session = await requireUser().catch(() => null);
    if (session && session.user.id !== verified.userId) {
      settingsUrl.searchParams.set("calendar_error", "state_mismatch");
      return NextResponse.redirect(settingsUrl);
    }

    await handleCalendarCallback(code, verified.userId);
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
