import { eq, isNull, sql as dsql } from "drizzle-orm";
import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Deletes the caller's account and everything personal in it.
 *
 * Apple requires an in-app way to delete the account for any app with sign-in
 * (App Store guideline 5.1.1(v)), so this is a submission blocker for the iOS
 * build, not a nicety. It is also the honest thing to offer on the web.
 *
 * HOW THE DELETE ACTUALLY HAPPENS: every table carrying a `user_id` has an
 * `ON DELETE CASCADE` foreign key to `auth.users`, so removing the auth user
 * removes workouts, history (via completed_workouts -> workout_exercises ->
 * workout_sets), routines, schedules, templates, settings, goals, PR history,
 * push subscriptions, rest notifications, AI usage and the encrypted Google
 * Calendar tokens. We do not hand-delete those; the database does, in one
 * transaction, which is the only way to be sure nothing is missed as tables
 * are added later.
 *
 * THE ONE THING THAT MUST NOT CASCADE: `exercises.user_id` also cascades, but
 * the exercise CATALOG IS SHARED - every user picks from the same list
 * regardless of who first created a row (that has been true since Item 9). At
 * the time of writing one account owns 65 catalog rows and another owns 37,
 * with 221 history rows across the app pointing at user-owned exercises. So a
 * plain deleteUser would delete a departing user's exercises out from under
 * everyone else, and orphan history rows whose `exercise_id` is a plain
 * varchar with no foreign key to protect it (the assisted flag, muscle groups
 * and PR direction are all read from the catalog, not the snapshot).
 *
 * Their `user_id` is therefore set to NULL first, which is exactly the shape
 * the 51 seeded rows already have: still in the shared catalog, owned by
 * nobody. The user's own workouts still disappear; only the catalog entries
 * they contributed survive, which is the same bargain as a public wiki edit.
 */
export const POST = handle(async () => {
  const { user } = await requireUser();

  // Orphan the shared catalog rows BEFORE the cascade can take them. Scoped to
  // this user, and a no-op for rows already unowned.
  const orphaned = await db
    .update(exercises)
    .set({ userId: null })
    .where(eq(exercises.userId, user.id))
    .returning({ id: exercises.id });

  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    // The orphaning above is deliberately NOT rolled back: leaving a catalog
    // row unowned is harmless and idempotent, and a retry of this route will
    // simply find nothing left to orphan.
    console.error("[account/delete] deleteUser failed:", error.message);
    throw new ApiError(500, "Could not delete the account. Please try again.");
  }

  // Prove the cascade actually ran rather than trusting it. If any row for this
  // user survives, the account is in a half-deleted state and we want to know.
  const [{ leftovers }] = (await db.execute(dsql`
    select (
      (select count(*) from completed_workouts where user_id = ${user.id}::uuid) +
      (select count(*) from scheduled_workouts where user_id = ${user.id}::uuid) +
      (select count(*) from routines where user_id = ${user.id}::uuid) +
      (select count(*) from user_settings where user_id = ${user.id}::uuid) +
      (select count(*) from google_calendar_tokens where user_id = ${user.id}::uuid) +
      (select count(*) from push_subscriptions where user_id = ${user.id}::uuid)
    )::int as leftovers`)) as unknown as Array<{ leftovers: number }>;

  if (leftovers > 0) {
    console.error(`[account/delete] cascade left ${leftovers} row(s) for ${user.id}`);
  }

  // Count what stayed in the shared catalog, so the client can say so plainly.
  const [{ n: catalogKept }] = (await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(exercises)
    .where(isNull(exercises.userId))) as unknown as Array<{ n: number }>;

  return {
    ok: true,
    exercisesReleasedToCatalog: orphaned.length,
    catalogUnownedTotal: catalogKept,
    leftovers,
  };
});
