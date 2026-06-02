import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for Server Components, Route Handlers, and Server Actions.
 * Reads the auth cookie via Next.js cookies() so RLS picks up the right user.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components can't set cookies — ignore. The proxy refreshes them.
          }
        },
      },
    },
  );
}

/**
 * Authenticated user resolved from the session cookie via LOCAL JWT
 * verification (getClaims), NOT a network call to the Auth server (getUser).
 *
 * This project signs tokens with ES256 (asymmetric), so getClaims verifies the
 * JWT signature locally via WebCrypto against the cached JWKS — zero per-request
 * round-trips on the hot path (every nav + every API call used to pay a
 * getUser() network call). The session is still refreshed through the same
 * cookie handlers when the token is near expiry, so cookie behavior is
 * unchanged. Verification is cryptographic, so this is as secure as getUser()
 * for establishing identity (unlike the legacy insecure getSession()).
 *
 * Returns null when there's no valid session. Only `id` + `email` are surfaced
 * because that's all our routes/pages consume. If you need user_metadata
 * (name, avatar), use the browser client's getUser() — see use-auth.ts.
 */
export async function getServerUser(): Promise<{
  id: string;
  email: string | null;
} | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: claims.email ?? null };
}
