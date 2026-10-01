"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ExerciseProgressChart, type ProgressPoint } from "@/components/ExerciseProgressChart";
import { apiRequest } from "@/lib/queryClient";
import { clientTimeZone } from "@/lib/date";

/**
 * The exercise's trend, opened from the tracker without leaving the workout.
 *
 * Ivo, 2026-09-30: "a little button to see the trend line for that exercise
 * during tracking would be neat". The chart is the exercise page's own, fed by
 * the same `loadExerciseProgress`, so the two cannot disagree - and it is
 * VIEW-ONLY here: correcting a past session belongs on the exercise page, not
 * between sets.
 *
 * Nothing is fetched until the sheet opens. The tracker is the screen that has
 * to stay fast, and most sessions will never open this.
 */
export function ExerciseTrendSheet({
  exerciseId,
  exerciseName,
  weightUnit,
  open,
  onOpenChange,
}: {
  exerciseId: string;
  exerciseName: string;
  weightUnit: "lbs" | "kg";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useQuery<{ points: ProgressPoint[] }>({
    queryKey: [`/api/exercises/${exerciseId}/progress`, clientTimeZone()],
    // Its own fetcher: the default one joins the key into a PATH, which is how
    // two tracker queries 404'd for nineteen days.
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/exercises/${exerciseId}/progress?tz=${encodeURIComponent(clientTimeZone())}`,
        )
      ).json(),
    enabled: open,
  });

  const points = data?.points ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto"
        data-testid="sheet-exercise-trend"
      >
        <SheetHeader>
          <SheetTitle>{exerciseName}</SheetTitle>
          <SheetDescription>
            Every session you have logged, oldest to newest. Tap a point to see its sets.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : isError ? (
            <p className="text-sm text-muted-foreground">Could not load the trend. Try again in a moment.</p>
          ) : points.length < 2 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-trend-too-short">
              {points.length === 0
                ? "No history for this exercise yet. This session starts it."
                : "One session so far. The line starts with the next one."}
            </p>
          ) : (
            <ExerciseProgressChart
              points={points}
              weightUnit={weightUnit}
              exerciseId={exerciseId}
              exerciseName={exerciseName}
              readOnly
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
