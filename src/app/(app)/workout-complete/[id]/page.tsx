import { and, eq, lt } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Trophy, Flame } from "lucide-react";
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

  // Prior completed workouts (excluding this one) - for streak + PR detection
  const prior = await db
    .select({
      id: completedWorkouts.id,
      completedAt: completedWorkouts.completedAt,
    })
    .from(completedWorkouts)
    .where(
      and(
        eq(completedWorkouts.userId, user.id),
        lt(completedWorkouts.completedAt, workout.completedAt),
      ),
    );

  // Phase 4d: assemble this workout + all prior from the normalized tables (sole
  // store) for the summary + PR detection.
  const normalized = await assembleNormalizedExercises([
    workout.id,
    ...prior.map((p) => p.id),
  ]);
  const workoutForStats = {
    ...workout,
    exercises: (normalized.get(workout.id) ?? []) as unknown,
  };
  const priorForStats = prior.map((p) => ({
    exercises: (normalized.get(p.id) ?? []) as unknown,
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

  // Persist new PRs (idempotent - skip if a row already exists for this workout/exercise/type)
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

  // Per-exercise recap (name + completed sets × reps) for the 9:16 share card's
  // exercise list. Derived from the same normalized rows used for the summary.
  const exerciseList = (
    (normalized.get(workout.id) ?? []) as unknown as Array<{
      name: string | null;
      setsData?: Array<{ reps: number | null; completed: boolean }>;
    }>
  )
    .map((ex) => {
      const done = (ex.setsData ?? []).filter((s) => s.completed);
      return {
        name: ex.name ?? "Exercise",
        sets: done.length,
        reps: done.length ? done[done.length - 1].reps : null,
      };
    })
    .filter((e) => e.sets > 0);

  return (
    <div className="mx-auto max-w-md pb-2">
      {/* Celebratory hero - neon radial glow + scattered confetti */}
      <div className="relative overflow-hidden bg-[radial-gradient(120%_70%_at_50%_0%,rgba(229,255,0,0.14),rgba(229,255,0,0)_60%)] px-6 pb-7 pt-9 text-center">
        {/* confetti dots */}
        <span className="pointer-events-none absolute left-10 top-8 h-[7px] w-[7px] rotate-[20deg] rounded-[2px] bg-primary" />
        <span className="pointer-events-none absolute right-12 top-14 h-2 w-2 rounded-full bg-white/70" />
        <span className="pointer-events-none absolute left-16 top-24 h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="pointer-events-none absolute right-20 top-11 h-1.5 w-1.5 rotate-[30deg] rounded-[2px] bg-success" />
        <span className="pointer-events-none absolute right-10 top-28 h-[5px] w-[5px] rotate-45 rounded-[2px] bg-primary" />
        <span className="pointer-events-none absolute left-10 top-36 h-1.5 w-1.5 rounded-full bg-white/50" />

        <div className="relative flex flex-col items-center">
          <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full border-[1.5px] border-yellow bg-primary-dim text-primary shadow-[0_0_40px_-6px_rgba(229,255,0,0.4)]">
            <Trophy className="h-10 w-10" strokeWidth={1.8} />
          </div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
            Workout complete
          </div>
          <div className="mt-2.5">
            <WorkoutNameEditor workoutId={workout.id} initialName={workout.name} />
          </div>
          <p className="mt-1.5 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
            {completedDateLabel}
          </p>
          {streakDays > 0 ? (
            <div className="mt-3.5 inline-flex items-center gap-1.5 rounded-full border border-yellow bg-primary-dim px-3.5 py-1.5 text-[13px] font-semibold text-primary">
              <Flame className="h-3.5 w-3.5" />
              <span>
                <span className="font-mono">{streakDays}</span> day streak, keep it up!
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 pb-6">
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Duration" value={formatDuration(summary.durationSeconds)} />
          <Stat label="Sets" value={summary.totalSets.toString()} />
          <Stat
            label="Volume"
            value={`${summary.totalVolumeLbs.toLocaleString()} lb`}
          />
          <Stat label="Exercises" value={summary.exerciseCount.toString()} />
        </div>

        {/* Personal bests */}
        {prHits.length > 0 ? (
          <section className="rounded-[18px] border-[1.5px] border-yellow bg-[radial-gradient(120%_100%_at_0%_0%,rgba(229,255,0,0.1),rgba(229,255,0,0.03))] p-[18px]">
            <div className="flex items-center gap-2">
              <Trophy className="h-[18px] w-[18px] text-primary" strokeWidth={1.8} />
              <h2 className="text-base font-bold text-primary">
                {prHits.length} new personal best{prHits.length !== 1 ? "s" : ""}
              </h2>
            </div>
            <div className="mt-3.5 flex flex-col">
              {prHits.map((h, i) => (
                <div
                  key={`${h.exerciseId}-${h.type}-${i}`}
                  className={`flex items-baseline justify-between gap-2.5 ${
                    i > 0 ? "mt-3 border-t border-divider pt-3" : ""
                  }`}
                >
                  <span className="text-sm font-semibold text-foreground">
                    {h.exerciseName}
                  </span>
                  <span className="whitespace-nowrap font-mono text-[13px] text-foreground">
                    {h.type === "weight"
                      ? `${h.newValue} lb`
                      : `${h.newValue.toLocaleString()} vol`}
                    {h.previousValue != null ? (
                      <span className="ml-1.5 text-[11px] text-tertiary-foreground">
                        was{" "}
                        {h.type === "weight"
                          ? h.previousValue
                          : h.previousValue.toLocaleString()}
                      </span>
                    ) : (
                      <span className="ml-1.5 text-[11px] text-primary">first time!</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* Muscles trained */}
        {muscleEntries.length > 0 ? (
          <section className="card-elevated p-5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Muscles trained
            </h2>
            <div className="mt-4 space-y-3.5">
              {muscleEntries.map(([muscle, sets]) => {
                const pct = Math.min(
                  100,
                  Math.round((sets / WEEKLY_TARGET_PER_MUSCLE) * 100),
                );
                return (
                  <div key={muscle} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-foreground">{muscle}</span>
                      <span className="font-mono text-xs text-tertiary-foreground">
                        {sets}/{WEEKLY_TARGET_PER_MUSCLE}
                      </span>
                    </div>
                    <div className="h-[7px] overflow-hidden rounded-full bg-white/[0.08]">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Actions - circular Share + primary Done */}
        <div className="flex gap-2.5 pt-1">
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
            exercises={exerciseList}
          />
          <Link
            href="/"
            className="flex h-14 flex-1 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-base font-bold text-primary-foreground shadow-cta-strong hover:opacity-95"
          >
            Done
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-elevated p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-tertiary-foreground">
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl font-bold text-foreground">{value}</div>
    </div>
  );
}
