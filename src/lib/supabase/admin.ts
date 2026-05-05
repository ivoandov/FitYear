import { createClient } from "@supabase/supabase-js";

/**
 * Server-only admin client using the secret key. Bypasses RLS.
 * Never import into a client component or expose to the browser.
 */
export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
