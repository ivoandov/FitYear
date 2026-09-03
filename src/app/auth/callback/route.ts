import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasCompletedOnboarding, setOnboardedCookie } from "@/lib/api/onboarding-cookie";

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
  // Shared with /api/auth/native-session, which does the same two things for a
  // sign-in that never reaches this route.
  const onboarded = await hasCompletedOnboarding(data.user.id);
  const dest = onboarded ? next : "/onboarding";

  const response = NextResponse.redirect(new URL(dest, url));
  setOnboardedCookie(response, onboarded);
  return response;
}
