import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/_next",
  "/favicon.ico",
  "/manifest.json",
  // The legal pages must render with no session: App Review reads them, Google's
  // OAuth consent screen links to the privacy policy, and a signed-out visitor
  // has to be able to read both before deciding to sign up.
  "/privacy",
  "/terms",
  // The service worker script must stay fetchable even when the session cookie
  // has expired: the browser re-fetches /sw.js on its own schedule, and a 307
  // to the login HTML would replace the worker with a broken one.
  "/sw.js",
  // Workflow's internal callbacks (the rest-timer push sleeps in a workflow and
  // POSTs itself back here to resume). They carry no session cookie, so the
  // auth gate would redirect them to /login and the workflow would never
  // resume; the Workflow runtime authenticates these requests itself.
  "/.well-known/workflow",
  // Machine-to-machine integration reads (2026-08-25, for Liv). Another service
  // has no Supabase session cookie, so this gate would 307 it to the login HTML
  // no matter how correct its own auth was. "Public" here means ONLY that the
  // cookie gate does not apply: every route under /api/integrations/
  // authenticates itself with a shared secret bound to one user id
  // (lib/api/integration-auth.ts) and is READ-ONLY. Do not put anything under
  // this prefix that writes, or that authenticates any other way.
  "/api/integrations",
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

  // Validate the session via LOCAL JWT verification (getClaims) instead of a
  // network call to the Auth server (getUser). This proxy runs on every
  // navigation (RSC fetch) AND every /api request, so getUser() was adding a
  // Supabase round-trip to each one — the main source of tab-switch lag.
  // Tokens are ES256-signed, so getClaims verifies the signature locally via
  // WebCrypto against the cached JWKS (no per-request network). It still
  // refreshes the session cookie through the same cookie handlers when the
  // token is near expiry, so the refresh-on-expiry behavior is preserved.
  const { data, error } = await supabase.auth.getClaims();
  const user = error ? null : (data?.claims ?? null);

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
  //
  // API routes are EXEMPT: they authenticate themselves and are the client's
  // mutation channel, so never bounce a fetch/XHR to the HTML /onboarding page.
  // In particular `PATCH /api/user-settings` (the call that CLEARS the flag)
  // was getting 307'd here to /onboarding — a method-preserving redirect onto a
  // page route -> 405 -> the write never ran, the cookie never flipped, and the
  // user was trapped on onboarding forever. This gate only runs for already-
  // authenticated users, so exempting /api changes no auth exposure.
  if (
    user &&
    !isPublicPath(pathname) &&
    pathname !== "/onboarding" &&
    !pathname.startsWith("/api/")
  ) {
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
  // `.well-known/workflow/` is excluded here too (not just via PUBLIC_PATHS):
  // the Workflow docs call this out for Next 16 specifically, since anything
  // intercepting its internal POST /flow request breaks workflow resumption.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/workflow/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|ogg|mp3|wav|m4a)$).*)",
  ],
};
