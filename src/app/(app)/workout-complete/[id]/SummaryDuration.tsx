"use client";

import { createContext, useContext, useState, type ComponentProps, type ReactNode } from "react";
import { ShareWorkoutButton } from "@/components/ShareWorkoutButton";
import { WorkoutDurationEditor } from "@/components/WorkoutDurationEditor";
import { formatDuration } from "@/lib/workout-stats";

/**
 * The summary screen's duration, shared by the stat that edits it and the share
 * card that prints it.
 *
 * The page is a server component and used to hand the share card a finished
 * label, so correcting the duration on screen would still have shared the old
 * one. Both read this instead.
 */
const DurationContext = createContext<{
  seconds: number | null;
  setSeconds: (s: number) => void;
} | null>(null);

export function SummaryDurationProvider({
  initialSeconds,
  children,
}: {
  initialSeconds: number | null;
  children: ReactNode;
}) {
  const [seconds, setSeconds] = useState(initialSeconds);
  return (
    <DurationContext.Provider value={{ seconds, setSeconds }}>{children}</DurationContext.Provider>
  );
}

function useSummaryDuration() {
  const ctx = useContext(DurationContext);
  if (!ctx) throw new Error("SummaryDuration used outside SummaryDurationProvider");
  return ctx;
}

/** Same card as the page's other stats, with the value editable in place. */
export function SummaryDurationStat({ workoutId }: { workoutId: string }) {
  const { seconds, setSeconds } = useSummaryDuration();
  return (
    <div className="card-elevated p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-tertiary-foreground">
        Duration
      </div>
      <div className="mt-2">
        <WorkoutDurationEditor
          workoutId={workoutId}
          seconds={seconds}
          valueClassName="font-mono text-2xl font-bold text-foreground"
          testIdSuffix="summary"
          onSaved={setSeconds}
        />
      </div>
    </div>
  );
}

export function SummaryShareButton(
  props: Omit<ComponentProps<typeof ShareWorkoutButton>, "durationLabel">,
) {
  const { seconds } = useSummaryDuration();
  return <ShareWorkoutButton {...props} durationLabel={formatDuration(seconds)} />;
}
