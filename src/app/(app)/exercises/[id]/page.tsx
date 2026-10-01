import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { getServerUser } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import { exercises, userSettings } from "@/lib/db/schema";
import { ExerciseProgressChart } from "@/components/ExerciseProgressChart";
import { rewriteImageUrl } from "@/lib/image-url";
import { lbsToDisplay } from "@/lib/units";
import { overloadSuggestion } from "@/lib/analytics";
import { viewerTimeZone } from "@/lib/server-timezone";
import { MuscleGroupsLabel } from "@/components/MuscleGroupsLabel";
import { loadExerciseProgress } from "@/lib/api/exercise-progress";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

// Epley lives in lib/workout-stats so this page, the records card and the
// strength-trend SQL cannot drift apart (they previously disagreed at reps=1
// and above the clamp).


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

  // One implementation, shared with the tracker's trend sheet
  // (lib/api/exercise-progress) so the two cannot draw different histories.
  const isAssisted = !!exercise.isAssisted;
  const points = await loadExerciseProgress(user.id, id, {
    isAssisted,
    // Viewer's zone, not the server's: on Vercel the server is UTC, which
    // pushed evening workouts onto the next chart day.
    timeZone: await viewerTimeZone(),
  });

  const totalVolumeLbs = points.reduce((acc, p) => acc + p.bestVolumeLbs, 0);
  // Assisted: the best all-time set is the LIGHTEST assist across sessions.
  const heaviestLbs = isAssisted
    ? points.reduce(
        (acc, p) => (p.bestWeightLbs > 0 && (acc === 0 || p.bestWeightLbs < acc) ? p.bestWeightLbs : acc),
        0,
      )
    : points.reduce((acc, p) => Math.max(acc, p.bestWeightLbs), 0);
  const max1RMLbs = points.reduce((acc, p) => Math.max(acc, p.best1RMLbs), 0);

  // Progressive-overload suggestion for the next session, from the most recent
  // workout's top set (points are chronological, so the last is the latest).
  const recent = points.length ? points[points.length - 1] : null;
  const overload =
    recent && recent.sets.length
      ? (() => {
          // The "top" set on an assisted lift is the one with the LEAST
          // assistance. Picking the max fed the easiest set into
          // overloadSuggestion, which then proposed MORE assistance than the
          // user had already worked with that day.
          const top = recent.sets.reduce((best, s) =>
            (isAssisted ? s.weightLbs < best.weightLbs : s.weightLbs > best.weightLbs) ||
            (s.weightLbs === best.weightLbs && s.reps > best.reps)
              ? s
              : best,
          );
          return {
            ...overloadSuggestion({
              lastTopWeightLbs: top.weightLbs,
              lastReps: top.reps,
              isAssisted: !!exercise.isAssisted,
            }),
            lastWeightLbs: top.weightLbs,
            lastReps: top.reps,
          };
        })()
      : null;

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
            <MuscleGroupsLabel
              groups={(exercise.muscleGroups as string[] | null) ?? []}
              className="mb-2 block font-mono text-xs"
            />
            <h1 className="text-2xl font-bold tracking-tight">
              {exercise.name}
            </h1>
            {exercise.isAssisted ? (
              <p className="text-xs text-muted-foreground mt-1">
                Assisted exercise - lower weight = harder.
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
                value={`${Math.round(lbsToDisplay(totalVolumeLbs, weightUnit) ?? 0).toLocaleString()} ${weightUnit}`}
              />
              <Stat
                label="Heaviest"
                value={`${lbsToDisplay(heaviestLbs, weightUnit) ?? 0} ${weightUnit}`}
              />
              <Stat
                label="Est. 1RM"
                value={`${lbsToDisplay(max1RMLbs, weightUnit) ?? 0} ${weightUnit}`}
              />
            </div>

            {overload ? (
              <div
                className="flex items-start gap-3 rounded-2xl border-[1.5px] border-yellow bg-primary-dim p-4"
                data-testid="card-overload"
              >
                <TrendingUp className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
                    Next session · progressive overload
                  </div>
                  <div className="mt-1.5 text-[15px] font-bold">
                    Try {lbsToDisplay(overload.suggestedWeightLbs, weightUnit)} {weightUnit}
                    {exercise.isAssisted ? " assist" : ""} × {overload.suggestedReps}
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-foreground/80">
                    {overload.rationale}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-tertiary-foreground">
                    Last: {lbsToDisplay(overload.lastWeightLbs, weightUnit)} {weightUnit}
                    {exercise.isAssisted ? " assist" : ""} × {overload.lastReps}
                  </p>
                </div>
              </div>
            ) : null}

            {Array.isArray(exercise.formCues) && exercise.formCues.length > 0 ? (
              <div className="card-elevated p-4" data-testid="card-form-cues">
                <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-tertiary-foreground">
                  How to do it
                </div>
                <ul className="mt-2 space-y-1.5">
                  {(exercise.formCues as string[]).map((cue, i) => (
                    <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-foreground/90">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                      {cue}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {typeof exercise.videoId === "string" && exercise.videoId ? (
              <div className="card-elevated overflow-hidden" data-testid="card-form-video">
                <div className="aspect-video w-full">
                  {/* Embedded, never re-hosted: the standard player is exactly
                      what YouTube provides for this, so nothing is licensed and
                      nothing is stored. */}
                  <iframe
                    className="h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${exercise.videoId}`}
                    title={`${exercise.name} demonstration`}
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            ) : null}

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
