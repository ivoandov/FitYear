import { and, eq, lt } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Trophy, Flame, Clock, Dumbbell, BarChart3, Zap } from "lucide-react";
import { ShareWorkoutButton } from "@/components/ShareWorkoutButton";
import { WorkoutNameEditor } from "@/components/WorkoutNameEditor";
import { getServerUser } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { completedWorkouts, prHistory, exercises } from "@/lib/db/schema";
import {
  summarizeWorkout,
  formatDuration,
  calcStreak,
  detectPRs,
} from "@/lib/workout-stats";
import { assembleNormalizedExercises } from "@/lib/db/normalized-workout";

type Ctx = { params: Promise<{ id: string }> };

const WEEKLY_TARGET_PER_MUSCLE = 20;

export default async function WorkoutCompletePage({ params }: Ctx) {
  const { id } = await params;

  const user = await getServerUser();
  if (!user) notFound();

  const [workout] = await db
    .select()
    .from(completedWorkouts)
    .where(
      and(
        eq(completedWorkouts.id, id),
        eq(completedWorkouts.userId, user.id),
      ),
    )
    .limit(1);
  if (!workout) notFound();

  // Prior completed workouts (excluding this one) — for streak + PR detection
  const prior = await db
    .select({
      id: completedWorkouts.id,
      exercises: completedWorkouts.exercises,
      completedAt: completedWorkouts.completedAt,
    })
    .from(completedWorkouts)
    .where(
      and(
        eq(completedWorkouts.userId, user.id),
        lt(completedWorkouts.completedAt, workout.completedAt),
      ),
    );

  // Phase 4c: assemble this workout + all prior from the normalized tables for
  // the summary + PR detection, falling back to each row's jsonb.
  const normalized = await assembleNormalizedExercises([
    workout.id,
    ...prior.map((p) => p.id),
  ]);
  const workoutForStats = {
    ...workout,
    exercises: (normalized.get(workout.id) ?? workout.exercises) as unknown,
  };
  const priorForStats = prior.map((p) => ({
    exercises: (normalized.get(p.id) ?? p.exercises) as unknown,
  }));

  const summary = summarizeWorkout(workoutForStats);
  const streakDays = calcStreak([
    workout.completedAt,
    ...prior.map((p) => p.completedAt),
  ]);

  // PR detection needs isAssisted per exercise so assisted-machine exercises
  // invert the weight comparison (less counterweight = harder = PR).
  const allExercises = await db
    .select({ id: exercises.id, isAssisted: exercises.isAssisted })
    .from(exercises);
  const isAssistedById = new Map(
    allExercises.map((e) => [e.id, !!e.isAssisted]),
  );
  const prHits = detectPRs(workoutForStats, priorForStats, isAssistedById);

  // Persist new PRs (idempotent — skip if a row already exists for this workout/exercise/type)
  if (prHits.length > 0) {
    const existing = await db
      .select({
        exerciseId: prHistory.exerciseId,
        prType: prHistory.prType,
      })
      .from(prHistory)
      .where(
        and(
          eq(prHistory.userId, user.id),
          eq(prHistory.workoutId, workout.id),
        ),
      );
    const seen = new Set(existing.map((e) => `${e.exerciseId}:${e.prType}`));
    const toInsert = prHits.filter(
      (h) => !seen.has(`${h.exerciseId}:${h.type}`),
    );
    if (toInsert.length) {
      await db.insert(prHistory).values(
        toInsert.map((h) => ({
          userId: user.id,
          exerciseId: h.exerciseId,
          workoutId: workout.id,
          prType: h.type,
          newValue: h.newValue,
          previousValue: h.previousValue,
        })),
      );
    }
  }

  // Sort muscle groups by sets descending
  const muscleEntries = Array.from(summary.muscleGroups.entries()).sort(
    ([, a], [, b]) => b - a,
  );

  const completedDateLabel = new Date(workout.completedAt).toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric" },
  );

  return (
    <div className="flex flex-col gap-6 p-5 sm:p-6 max-w-md mx-auto">
      {/* Trophy hero */}
      <div className="flex flex-col items-center gap-3 pt-4 text-center">
        <div className="rounded-full bg-primary/10 p-5">
          <Trophy className="h-10 w-10 text-primary" />
        </div>
        <WorkoutNameEditor workoutId={workout.id} initialName={workout.name} />
        <p className="text-sm text-muted-foreground">{completedDateLabel}</p>
        {streakDays > 0 ? (
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            <Flame className="h-3.5 w-3.5" />
            {streakDays} day streak — keep it up!
          </div>
        ) : null}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <Stat
          icon={<Clock className="h-4 w-4" />}
          label="Duration"
          value={formatDuration(summary.durationSeconds)}
        />
        <Stat
          icon={<Dumbbell className="h-4 w-4" />}
          label="Sets"
          value={summary.totalSets.toString()}
        />
        <Stat
          icon={<BarChart3 className="h-4 w-4" />}
          label="Volume"
          value={`${summary.totalVolumeLbs.toLocaleString()} lbs`}
        />
        <Stat
          icon={<Zap className="h-4 w-4" />}
          label="Exercises"
          value={summary.exerciseCount.toString()}
        />
      </div>

      {/* Muscles trained */}
      {muscleEntries.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Muscles trained</h2>
          <div className="space-y-2.5">
            {muscleEntries.map(([muscle, sets]) => {
              const pct = Math.min(
                100,
                Math.round((sets / WEEKLY_TARGET_PER_MUSCLE) * 100),
              );
              return (
                <div key={muscle} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{muscle}</span>
                    <span className="text-muted-foreground">
                      {sets} / {WEEKLY_TARGET_PER_MUSCLE} sets
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Personal bests */}
      {prHits.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-5">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold text-primary">
              {prHits.length} new personal best{prHits.length !== 1 ? "s" : ""}
            </h2>
          </div>
          <ul className="space-y-1.5 text-sm">
            {prHits.map((h, i) => (
              <li key={`${h.exerciseId}-${h.type}-${i}`} className="flex justify-between">
                <span className="font-medium">{h.exerciseName}</span>
                <span className="text-muted-foreground">
                  {h.type === "weight"
                    ? `${h.newValue} lbs`
                    : `${h.newValue.toLocaleString()} lbs vol`}
                  {h.previousValue != null ? (
                    <span className="ml-1.5 text-xs">
                      (was {h.type === "weight"
                        ? `${h.previousValue} lbs`
                        : `${h.previousValue.toLocaleString()}`})
                    </span>
                  ) : (
                    <span className="ml-1.5 text-xs">(first time!)</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-2">
        <ShareWorkoutButton
          workoutName={workout.name}
          date={completedDateLabel}
          durationLabel={formatDuration(summary.durationSeconds)}
          totalSets={summary.totalSets}
          totalVolumeLbs={summary.totalVolumeLbs}
          exerciseCount={summary.exerciseCount}
          muscleGroups={muscleEntries}
          prCount={prHits.length}
          prs={prHits.map((h) => ({
            exerciseName: h.exerciseName,
            type: h.type,
            newValue: h.newValue,
            previousValue: h.previousValue,
          }))}
          streakDays={streakDays}
        />
        <Link
          href="/"
          className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Done
        </Link>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
