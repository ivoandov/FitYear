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

// Seed a completed workout containing a specific exercise id at a given weight,
// so the tracker's historical-bests (PR detection) has a prior best to beat.
export async function seedCompletedFor(
  userId: string,
  exerciseId: string,
  name: string,
  weightLbs: number,
  reps: number,
): Promise<void> {
  const exercises = JSON.stringify([
    {
      id: exerciseId,
      name: "PR Exercise",
      muscleGroups: ["Chest"],
      exerciseType: "weight_reps",
      isAssisted: false,
      completedSets: 1,
      setsData: [
        { setNumber: 1, weight: weightLbs, reps, distance: 0, time: 0, completed: true },
      ],
    },
  ]);
  const [cw] = await sql`
    insert into completed_workouts (user_id, display_id, name, exercises, completed_at)
    values (${userId}::uuid, ${`e2e-pr-${Date.now()}-${counter++}`}, ${name}, ${exercises}::jsonb, now())
    returning id`;
  // Mirror into the normalized tables so seeds match real (dual-written) rows.
  const [we] = await sql`
    insert into workout_exercises
      (completed_workout_id, exercise_id, position, name_snapshot, muscle_groups_snapshot, exercise_type, is_assisted)
    values (${cw.id}, ${exerciseId}, 0, 'PR Exercise', ${JSON.stringify(["Chest"])}::jsonb, 'weight_reps', false)
    returning id`;
  await sql`
    insert into workout_sets (workout_exercise_id, set_number, weight_lbs, reps, distance, time, completed)
    values (${we.id}, 1, ${weightLbs}, ${reps}, 0, 0, true)`;
}

// Seed an exercise owned by a specific user. `is_public=false` on purpose so
// the test proves the catalog is fully shared regardless of the legacy flag
// (before Item 9, is_public=false hid it from other users).
export async function seedExercise(
  userId: string,
  name: string,
  muscleGroups: string[] = ["Forearms"],
  exerciseType: "weight_reps" | "distance_time" = "weight_reps",
): Promise<string> {
  const [row] = await sql`
    insert into exercises (user_id, is_public, name, muscle_groups, description, exercise_type)
    values (${userId}::uuid, false, ${name}, ${JSON.stringify(muscleGroups)}::jsonb, 'seeded by e2e', ${exerciseType})
    returning id`;
  return row.id as string;
}

// Seed a scheduled workout (row shows on the home page's Today/Upcoming list).
// Returns the new row id (used as the card's testId suffix).
export async function seedScheduledWorkout(
  userId: string,
  name: string,
  dateISO: string,
): Promise<string> {
  const exercises = JSON.stringify([
    { id: "seed-ex", name: "Bench Press", muscleGroups: ["Chest"], exerciseType: "weight_reps" },
  ]);
  const [row] = await sql`
    insert into scheduled_workouts (user_id, name, date, exercises)
    values (${userId}::uuid, ${name}, ${dateISO}::timestamp, ${exercises}::jsonb)
    returning id`;
  return row.id as string;
}

// Seed a workout template (row shows in the home page's "All Workouts" library).
export async function seedTemplate(
  userId: string,
  name: string,
): Promise<string> {
  const exercises = JSON.stringify([
    { id: "seed-ex", name: "Bench Press", muscleGroups: ["Chest"], exerciseType: "weight_reps" },
  ]);
  const [row] = await sql`
    insert into workout_templates (user_id, name, exercises)
    values (${userId}::uuid, ${name}, ${exercises}::jsonb)
    returning id`;
  return row.id as string;
}

// Seed the server-side active workout (+ tracking progress) for a user, so a
// fresh browser context restores it on /track. Used to construct states the UI
// won't build directly (e.g. the same exercise added twice).
export async function seedActiveWorkout(
  userId: string,
  workoutData: unknown,
  trackingProgress: unknown,
): Promise<void> {
  await sql`
    insert into active_workouts (user_id, workout_data, tracking_progress, updated_at)
    values (${userId}::uuid, ${JSON.stringify(workoutData)}::jsonb, ${JSON.stringify(trackingProgress)}::jsonb, now())
    on conflict (user_id) do update set
      workout_data = excluded.workout_data,
      tracking_progress = excluded.tracking_progress,
      updated_at = now()`;
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
