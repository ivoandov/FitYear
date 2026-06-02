import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Returns the authenticated user from the Supabase auth cookie.
 * Throws ApiError(401) when there's no session — caller's route handler
 * should catch and convert to a 401 JSON response (use withAuth wrapper).
 *
 * Uses getClaims() (local ES256 JWT verification, no Auth-server round-trip)
 * instead of getUser(). Every API route went through this, so each data fetch
 * was paying a network call just to re-validate the token; the proxy already
 * validated it on the same request. Routes only ever read `user.id`, so we
 * surface a minimal `{ id, email }`. The supabase client is still returned for
 * callers that need it.
 */
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) {
    throw new ApiError(401, "Unauthorized");
  }
  return {
    user: { id: claims.sub, email: claims.email ?? null },
    supabase,
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
