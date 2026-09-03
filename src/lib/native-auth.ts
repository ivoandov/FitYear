import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Native sign-in, for Apple and Google.
 *
 * WHY THIS EXISTS AT ALL. Google returns `403 disallowed_useragent` for an
 * OAuth redirect inside a WKWebView, deliberately and permanently - setting a
 * custom user agent does not get round it. So the redirect flow the website
 * uses is simply dead in the app, and native sign-in is not a nicety but the
 * only way in.
 *
 * HOW IT WORKS. The platform SDK returns a signed ID TOKEN. That goes straight
 * to `supabase.auth.signInWithIdToken`, which verifies it against the provider
 * and writes the same session cookies the web flow ends up with, so
 * `proxy.ts`, `requireUser()` and every API route are unchanged.
 *
 * THE NONCE. The RAW nonce goes to Supabase and its SHA-256 goes to the
 * provider: the provider signs the hash into the token, and Supabase re-hashes
 * the raw value to check they match. Sending the same value to both, or
 * swapping them, fails verification.
 */

export type NativeProvider = "apple" | "google";

export type NativeSignInResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "unavailable" | "failed"; message?: string };

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface SocialLoginResult {
  result?: {
    idToken?: string | null;
    profile?: { givenName?: string | null; familyName?: string | null } | null;
  } | null;
}

/**
 * Tell the server a native sign-in happened.
 *
 * The web flow gets `/auth/callback`; this one never touches the server, so
 * without this call `fy_onboarded` is never stamped and - because the proxy
 * treats a missing cookie as "already onboarded" - a brand-new user would skip
 * onboarding entirely.
 */
async function finishSession(name?: { firstName?: string; lastName?: string }): Promise<void> {
  try {
    await fetch("/api/auth/native-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(name ?? {}),
    });
  } catch {
    // Non-fatal: the session itself is already valid. Worst case the user sees
    // the app instead of onboarding, and the next sign-in fixes it.
  }
}

export async function signInNatively(provider: NativeProvider): Promise<NativeSignInResult> {
  let raw: string;
  try {
    const { SocialLogin } = await import("@capgo/capacitor-social-login");

    raw = crypto.randomUUID();
    const hashed = await sha256Hex(raw);

    const res = (await SocialLogin.login({
      provider,
      options: {
        scopes: ["email", "profile"],
        nonce: hashed,
      },
    })) as SocialLoginResult;

    const idToken = res.result?.idToken;
    if (!idToken) return { ok: false, reason: "failed", message: "No identity token returned." };

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithIdToken({
      provider,
      token: idToken,
      nonce: raw,
    });

    if (error) {
      // Google on iOS caches its token, and a cached one carries the PREVIOUS
      // nonce, so verification fails once after a sign-out. One clean retry
      // fixes it; failing here would look like a broken login button.
      if (provider === "google") {
        try {
          const { SocialLogin } = await import("@capgo/capacitor-social-login");
          await SocialLogin.logout({ provider });
          return await signInNatively("google");
        } catch {
          return { ok: false, reason: "failed", message: error.message };
        }
      }
      return { ok: false, reason: "failed", message: error.message };
    }

    // Apple gives the name on the FIRST sign-in ever and never again, so it has
    // to be captured here or it is lost permanently.
    await finishSession({
      firstName: res.result?.profile?.givenName ?? undefined,
      lastName: res.result?.profile?.familyName ?? undefined,
    });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(message)) return { ok: false, reason: "cancelled" };
    if (/not implemented|unimplemented|not available/i.test(message)) {
      return { ok: false, reason: "unavailable", message };
    }
    return { ok: false, reason: "failed", message };
  }
}
