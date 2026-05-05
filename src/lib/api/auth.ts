import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Returns the authenticated user from the Supabase auth cookie.
 * Throws ApiError(401) when there's no session — caller's route handler
 * should catch and convert to a 401 JSON response (use withAuth wrapper).
 */
export async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new ApiError(401, "Unauthorized");
  }
  return { user, supabase };
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
