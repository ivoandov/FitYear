import { eq, desc } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getServerUser } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { exercises, completedWorkouts, userSettings } from "@/lib/db/schema";
import {
  ExerciseProgressChart,
  type ProgressPoint,
} from "@/components/ExerciseProgressChart";
import { rewriteImageUrl } from "@/lib/image-url";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

// Epley one-rep-max estimate. weight × (1 + reps/30) — standard, simple,
// and reasonable across 1-15 rep ranges where most strength training lives.
function epley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

function toDisplay(lbs: number, unit: "lbs" | "kg"): number {
  return unit === "kg" ? lbs / 2.20462 : lbs;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type ExerciseInWorkoutJson = {
  id: string;
  name?: string;
  setsData?: Array<{
    weight?: number | null;
    reps?: number | null;
    completed?: boolean;
  }>;
};

export default async function ExerciseDetailPage({ params }: Ctx) {
  const { id } = await params;

  const user = await getServerUser();
  if (!user) redirect(`/login?next=/exercises/${id}`);

  // Exercise metadata. Public (userId NULL) or owned by this user.
  const [exercise] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, id))
    .limit(1);
  if (!exercise) notFound();
  if (exercise.userId && exercise.userId !== user.id) notFound();

  // DB stores legacy `/objects/...` image paths; rewrite to the GCS proxy at
  // `/api/objects/...` (same as the /api/exercises route) or the thumbnail 404s.
  const heroImageUrl = rewriteImageUrl(exercise.imageUrl);

  // User unit preference
  const [settings] = await db
    .select({ weightUnit: userSettings.weightUnit })
    .from(userSettings)
    .where(eq(userSettings.userId, user.id))
    .limit(1);
  const weightUnit = (settings?.weightUnit ?? "lbs") as "lbs" | "kg";

  // All completed workouts for this user (could narrow with a containment
  // query, but the indexed user_id scan + in-memory filter is plenty fast
  // for the ~100-row scale per user).
  const workouts = await db
    .select({
      id: completedWorkouts.id,
      name: completedWorkouts.name,
      completedAt: completedWorkouts.completedAt,
      exercises: completedWorkouts.exercises,
    })
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, user.id))
    .orderBy(desc(completedWorkouts.completedAt));

  const points: ProgressPoint[] = [];
  for (const w of workouts) {
    const exs = (w.exercises as ExerciseInWorkoutJson[]) ?? [];
    const match = exs.find((e) => e.id === id);
    if (!match?.setsData) continue;
    const completedSets = match.setsData
      .map((s, idx) => ({
        setIdx: idx,
        weight: s.weight ?? 0,
        reps: s.reps ?? 0,
        completed: !!s.completed,
      }))
      .filter((s) => s.completed && s.weight > 0 && s.reps > 0);
    if (completedSets.length === 0) continue;
    let bestWeight = 0;
    let bestVolume = 0;
    let best1RM = 0;
    for (const s of completedSets) {
      if (s.weight > bestWeight) bestWeight = s.weight;
      const v = s.weight * s.reps;
      if (v > bestVolume) bestVolume = v;
      const e = epley1RM(s.weight, s.reps);
      if (e > best1RM) best1RM = e;
    }
    // Drizzle returns timestamp columns as Date; use UTC slice for a stable
    // YYYY-MM-DD that doesn't shift across client TZs.
    const dateStr = new Date(w.completedAt).toISOString().slice(0, 10);
    points.push({
      workoutId: w.id,
      workoutName: w.name,
      date: dateStr,
      bestWeightLbs: bestWeight,
      bestVolumeLbs: bestVolume,
      best1RMLbs: best1RM,
      sets: completedSets.map((s) => ({
        setIdx: s.setIdx,
        weightLbs: s.weight,
        reps: s.reps,
      })),
      isOutlier: false, // computed below once we know the median
    });
  }
  // Chart wants chronological order; the DB query was DESC for stat-strip uses
  points.sort((a, b) => a.date.localeCompare(b.date));

  // Outlier: median 1RM, flag anything < 50% of it (matches the audit script
  // heuristic, surfaced visually here for self-serve detection + fix).
  const sorted1RMs = points.map((p) => p.best1RMLbs).sort((a, b) => a - b);
  const median1RM =
    sorted1RMs.length === 0
      ? 0
      : sorted1RMs.length % 2
        ? sorted1RMs[sorted1RMs.length >>> 1]
        : (sorted1RMs[sorted1RMs.length / 2 - 1] +
            sorted1RMs[sorted1RMs.length / 2]) /
          2;
  for (const p of points) {
    p.isOutlier = median1RM > 0 && p.best1RMLbs < median1RM * 0.5;
  }

  const totalVolumeLbs = points.reduce((acc, p) => acc + p.bestVolumeLbs, 0);
  const heaviestLbs = points.reduce(
    (acc, p) => Math.max(acc, p.bestWeightLbs),
    0,
  );
  const max1RMLbs = points.reduce((acc, p) => Math.max(acc, p.best1RMLbs), 0);

  return (
    <div className="flex-1">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <Link
          href="/exercises"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to exercises
        </Link>

        <div className="flex gap-4 items-start">
          {heroImageUrl ? (
            <div className="relative w-24 h-24 rounded-2xl overflow-hidden border bg-input shrink-0">
              <Image
                src={heroImageUrl}
                alt={exercise.name}
                fill
                sizes="96px"
                className="object-cover"
              />
            </div>
          ) : null}
          <div className="flex-1 min-w-0">
            <div className="flex gap-1.5 flex-wrap mb-2">
              {(exercise.muscleGroups as string[] | null)?.map((g) => (
                <span
                  key={g}
                  className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground"
                >
                  {g}
                </span>
              )) ?? null}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              {exercise.name}
            </h1>
            {exercise.isAssisted ? (
              <p className="text-xs text-muted-foreground mt-1">
                Assisted exercise — lower weight = harder.
              </p>
            ) : null}
          </div>
        </div>

        {points.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center text-muted-foreground shadow-inner-hi">
            No completed workouts for {exercise.name} yet. Log a workout to start
            tracking progress.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Workouts" value={String(points.length)} />
              <Stat
                label="Total volume"
                value={`${Math.round(toDisplay(totalVolumeLbs, weightUnit)).toLocaleString()} ${weightUnit}`}
              />
              <Stat
                label="Heaviest"
                value={`${round1(toDisplay(heaviestLbs, weightUnit))} ${weightUnit}`}
              />
              <Stat
                label="Est. 1RM"
                value={`${round1(toDisplay(max1RMLbs, weightUnit))} ${weightUnit}`}
              />
            </div>

            <ExerciseProgressChart
              points={points}
              weightUnit={weightUnit}
              exerciseId={id}
              exerciseName={exercise.name}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3 shadow-inner-hi">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums truncate">{value}</div>
    </div>
  );
}
