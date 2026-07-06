import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import postgres from "postgres";
import type { BrowserContext } from "@playwright/test";

const URL_S = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
const BASE = process.env.E2E_BASE_URL ?? "https://fityear.flyhi.ai";
// hostname (no port) — cookie domains must not include a port, so localhost:3000
// (used by the CI job) becomes "localhost".
const HOST = new URL(BASE).hostname;
const SECURE = BASE.startsWith("https");

// Admin client (service role) — creates/deletes throwaway test users only.
// NEVER touches the real accounts (thebballkid / cori / satchel / loic).
export const admin = createClient(URL_S, SECRET, {
  auth: { autoRefreshToken: false, persistSession: false },
});
export const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3 });

export type TempUser = { id: string; email: string; password: string };

let counter = 0;
export async function createTempUser(prefix = "e2e"): Promise<TempUser> {
  const email = `${prefix}-${Date.now()}-${counter++}@fityear.test`;
  const password = `Test!${Date.now()}aA`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createTempUser failed: ${error?.message}`);
  return { id: data.user.id, email, password };
}

export async function deleteTempUser(id: string): Promise<void> {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

export async function seedSettings(
  userId: string,
  weightUnit: "lbs" | "kg" = "lbs",
): Promise<void> {
  await sql`
    insert into user_settings (user_id, weight_unit, has_completed_onboarding)
    values (${userId}::uuid, ${weightUnit}, true)
    on conflict (user_id) do update set weight_unit = ${weightUnit}`;
}

export async function seedCompletedWorkout(
  userId: string,
  name: string,
): Promise<void> {
  const exercises = JSON.stringify([
    {
      id: "seed-ex",
      name: "Bench Press",
      muscleGroups: ["Chest"],
      exerciseType: "weight_reps",
      isAssisted: false,
      completedSets: 1,
      setsData: [
        { setNumber: 1, weight: 135, reps: 5, distance: 0, time: 0, completed: true },
      ],
    },
  ]);
  await sql`
    insert into completed_workouts (user_id, display_id, name, exercises, completed_at)
    values (${userId}::uuid, ${`e2e-${Date.now()}-${counter++}`}, ${name}, ${exercises}::jsonb, now())`;
}

export async function completedWorkoutCount(userId: string): Promise<number> {
  const r = await sql`select count(*)::int as n from completed_workouts where user_id = ${userId}::uuid`;
  return r[0].n as number;
}

// Mint a real Supabase session (email+password) via an SSR cookie jar and
// apply the resulting cookies to the Playwright browser context, so navigations
// authenticate exactly like a logged-in user.
export async function applyAuth(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<void> {
  const jar = new Map<string, string>();
  const supa = createServerClient(URL_S, PUB, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (list: { name: string; value: string }[]) =>
        list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`applyAuth signIn failed: ${error.message}`);
  await context.addCookies(
    [...jar.entries()].map(([name, value]) => ({
      name,
      value,
      domain: HOST,
      path: "/",
      secure: SECURE,
      httpOnly: false,
      sameSite: "Lax" as const,
    })),
  );
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 }).catch(() => {});
}
