import { eq } from "drizzle-orm";
import type { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";

/**
 * The `fy_onboarded` cookie, in one place, because TWO sign-in paths now set it.
 *
 * `proxy.ts` reads this cookie on every navigation to decide whether to bounce
 * the user to /onboarding, and it does so OPTIMISTICALLY - only a definitive
 * "0" redirects, so a missing cookie means "assume onboarded" and a brand-new
 * user would silently never see onboarding.
 *
 * The web flow sets it in `/auth/callback` after exchanging the OAuth code.
 * Native sign-in has no callback at all: the app gets an id token from Apple or
 * Google and hands it straight to Supabase, so nothing on the server ever runs.
 * `/api/auth/native-session` calls this instead. Keeping the read and the
 * cookie shape here means the two cannot drift into disagreeing about what
 * "onboarded" means.
 */

export const ONBOARDED_COOKIE = "fy_onboarded";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Has this user finished onboarding? One indexed read, at sign-in only. */
export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const [settings] = await db
    .select({ done: userSettings.hasCompletedOnboarding })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return !!settings?.done;
}

/**
 * Stamp the cookie on a response.
 *
 * Not httpOnly, matching the existing behaviour: it carries no secret and the
 * proxy treats it as a hint, not an authority. `sameSite: lax` so it survives
 * the OAuth redirect back from Google.
 */
export function setOnboardedCookie(response: NextResponse, onboarded: boolean): void {
  response.cookies.set(ONBOARDED_COOKIE, onboarded ? "1" : "0", {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });
}
