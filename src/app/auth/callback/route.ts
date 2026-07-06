import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";

const ONBOARDED_COOKIE = "fy_onboarded";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") || "/";
  // Open-redirect guard: only accept a same-origin path. An absolute
  // (`https://evil.com`) or protocol-relative (`//evil.com`) `next` would
  // otherwise redirect the freshly-authenticated user off-site.
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!code) {
    return NextResponse.redirect(new URL(`/login?error=missing_code`, url));
  }

  const supabase = await createSupabaseServerClient();
  const { error, data } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error?.message ?? "no_user")}`, url),
    );
  }

  // One-time DB read at login to decide onboarding state, then cache in a
  // cookie so the proxy can do an optimistic check on every nav without DB.
  const [settings] = await db
    .select({ done: userSettings.hasCompletedOnboarding })
    .from(userSettings)
    .where(eq(userSettings.userId, data.user.id))
    .limit(1);

  const onboarded = !!settings?.done;
  const dest = onboarded ? next : "/onboarding";

  const response = NextResponse.redirect(new URL(dest, url));
  response.cookies.set(ONBOARDED_COOKIE, onboarded ? "1" : "0", {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  return response;
}
