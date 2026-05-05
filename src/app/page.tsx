import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { completedWorkouts, exercises, workoutTemplates, exerciseGoals, profiles, googleCalendarTokens } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Proxy redirects to /login if no user, but TS needs the guard
  if (!user) return null;

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);

  const [{ count: completedCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, user.id));

  const [{ count: templateCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(workoutTemplates)
    .where(eq(workoutTemplates.userId, user.id));

  const [{ count: customExerciseCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(exercises)
    .where(eq(exercises.userId, user.id));

  const [{ count: goalCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(exerciseGoals)
    .where(eq(exerciseGoals.userId, user.id));

  const [{ count: calendarCount }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(googleCalendarTokens)
    .where(eq(googleCalendarTokens.userId, user.id));

  const name = profile?.firstName ?? user.email?.split("@")[0] ?? "Friend";

  return (
    <main className="flex flex-1 flex-col items-center p-6 pt-16">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <p className="text-muted-foreground">Welcome back,</p>
          <h1 className="text-3xl font-bold text-primary">{name}.</h1>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Migration smoke test — your data from Replit:
          </p>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Stat label="Completed workouts" value={completedCount} />
            <Stat label="Workout templates" value={templateCount} />
            <Stat label="Custom exercises" value={customExerciseCount} />
            <Stat label="Exercise goals" value={goalCount} />
            <Stat
              label="Calendar synced"
              value={calendarCount > 0 ? "yes" : "no"}
            />
            <Stat label="Email" value={user.email ?? "—"} />
          </dl>
        </div>

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="h-10 w-full rounded-lg border border-border text-sm text-muted-foreground hover:bg-secondary"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium text-foreground">{value}</dd>
    </div>
  );
}
