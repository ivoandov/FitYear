import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/_next",
  "/favicon.ico",
  "/manifest.json",
];

const ONBOARDED_COOKIE = "fy_onboarded";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the auth session cookie if expired.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Optimistic onboarding gate (cookie-based — set at login and on completion).
  // Only redirect when we have a definitive "0"; missing cookie means we treat
  // the user as already onboarded so we don't strand mid-session users without
  // the cookie. Auth callback fills the cookie on next sign-in.
  if (user && !isPublicPath(pathname) && pathname !== "/onboarding") {
    const onboarded = request.cookies.get(ONBOARDED_COOKIE)?.value;
    if (onboarded === "0") {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Exclude static media from the auth proxy so the login page's intro video
  // (and any other public asset) loads for unauthenticated visitors. Image
  // formats were already excluded; video + audio added 2026-06-01 after the
  // intro mp4 was getting 307'd to /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|ogg|mp3|wav|m4a)$).*)",
  ],
};
