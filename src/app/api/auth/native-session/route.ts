import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { hasCompletedOnboarding, setOnboardedCookie } from "@/lib/api/onboarding-cookie";

/**
 * Finishes a NATIVE sign-in, doing the two things `/auth/callback` does that
 * the native flow otherwise skips entirely.
 *
 * The web flow is a redirect: Supabase sends the browser to `/auth/callback`,
 * which exchanges the code, reads onboarding state and stamps the cookie.
 * Native sign-in never touches the server - the app gets an id token from
 * Apple or Google, hands it to `supabase.auth.signInWithIdToken`, and the
 * session cookies are written client-side. Nothing sets `fy_onboarded`, and
 * because `proxy.ts` treats a MISSING cookie as "already onboarded", a brand
 * new native user would sail straight past onboarding.
 *
 * The client calls this once, immediately after a successful native sign-in.
 * It is idempotent and safe to call again.
 */
export async function POST(request: Request) {
  let user: { id: string; email: string | null };
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const onboarded = await hasCompletedOnboarding(user.id);

  // Apple returns the user's NAME on the very first sign-in only, ever. If the
  // app captured one, persist it now or it is gone for good - a second sign-in
  // returns only the identifier. Google sends it every time, so this is
  // effectively Apple-only.
  let namePersisted = false;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      firstName?: unknown;
      lastName?: unknown;
    };
    const first = typeof body.firstName === "string" ? body.firstName.trim().slice(0, 80) : "";
    const last = typeof body.lastName === "string" ? body.lastName.trim().slice(0, 80) : "";

    if (first || last) {
      const [existing] = await db
        .select({ firstName: profiles.firstName, lastName: profiles.lastName })
        .from(profiles)
        .where(eq(profiles.id, user.id))
        .limit(1);

      // INSERT when there is no row at all. There is no trigger on auth.users
      // creating profiles (the schema comment says there was one in Phase 2;
      // there is not one now), so a brand-new user has no profile row - and an
      // update-only path would silently discard the name Apple sends exactly
      // once and never again. Verified by e2e, which is how this was found.
      //
      // Never overwrite a name that already exists: this runs on EVERY native
      // sign-in, and a later sign-in carries no name, so an unconditional write
      // would blank a good one on the second launch.
      if (!existing) {
        await db
          .insert(profiles)
          .values({
            id: user.id,
            email: user.email,
            firstName: first || null,
            lastName: last || null,
          })
          .onConflictDoNothing();
        namePersisted = true;
      } else if (!existing.firstName && !existing.lastName) {
        await db
          .update(profiles)
          .set({ firstName: first || null, lastName: last || null })
          .where(eq(profiles.id, user.id));
        namePersisted = true;
      }
    }
  } catch {
    // A name is a nicety; never fail the sign-in over it.
  }

  const response = NextResponse.json({ ok: true, onboarded, namePersisted });
  setOnboardedCookie(response, onboarded);
  return response;
}
