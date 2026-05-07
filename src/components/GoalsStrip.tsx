"use client";

import { useQuery } from "@tanstack/react-query";
import { startOfWeek, isAfter } from "date-fns";
import { Target, Calendar as CalendarIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useWorkout } from "@/context/WorkoutContext";
import { useSettings } from "@/components/SettingsProvider";

interface UserSettingsResponse {
  onboardingDaysPerWeek?: number | null;
  onboardingProgramLength?: number | null;
}

interface RoutineInstance {
  id: string;
  routineName: string;
  totalWorkouts: number;
  completedWorkouts: number;
  durationDays: number;
  startDate: string;
}

/**
 * Renders below the home greeting:
 *   - Weekly target card: completedWorkouts this week / daysPerWeek
 *   - Program card: current routine day / programLength (with progress bar)
 *
 * Hidden if neither goal is set (user skipped onboarding).
 */
export function GoalsStrip() {
  const { weekStart } = useSettings();
  const { completedWorkouts } = useWorkout();
  const { data: settings } = useQuery<UserSettingsResponse>({
    queryKey: ["/api/user-settings"],
  });
  const { data: activeRoutines = [] } = useQuery<RoutineInstance[]>({
    queryKey: ["/api/routine-instances/active"],
  });

  const daysPerWeek = settings?.onboardingDaysPerWeek ?? null;
  const programLength = settings?.onboardingProgramLength ?? null;
  const activeRoutine = activeRoutines[0] ?? null;

  if (!daysPerWeek && !activeRoutine) return null;

  const weekStartDate = startOfWeek(new Date(), {
    weekStartsOn: weekStart === "monday" ? 1 : 0,
  });
  const completedThisWeek = completedWorkouts.filter((w) =>
    isAfter(w.completedAt, weekStartDate),
  ).length;

  const weeklyPct = daysPerWeek
    ? Math.min(100, Math.round((completedThisWeek / daysPerWeek) * 100))
    : 0;

  const totalDays = activeRoutine?.durationDays ?? programLength ?? 0;
  const dayNumber = activeRoutine
    ? activeRoutine.completedWorkouts + 1
    : null;
  const programPct =
    activeRoutine && totalDays
      ? Math.min(100, Math.round((activeRoutine.completedWorkouts / totalDays) * 100))
      : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {daysPerWeek ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            Weekly target
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold tabular-nums">
              {completedThisWeek} <span className="text-muted-foreground text-base">/ {daysPerWeek} days</span>
            </span>
          </div>
          <Progress value={weeklyPct} className="[&>div]:bg-primary" />
        </div>
      ) : null}

      {activeRoutine ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <CalendarIcon className="h-3.5 w-3.5" />
            Program
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold tabular-nums">
              Day {dayNumber}
              <span className="text-muted-foreground text-base"> of {totalDays}</span>
            </span>
            <span className="text-xs text-muted-foreground truncate ml-2 min-w-0">
              {activeRoutine.routineName}
            </span>
          </div>
          <Progress value={programPct} className="[&>div]:bg-primary" />
        </div>
      ) : programLength ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <CalendarIcon className="h-3.5 w-3.5" />
            Program
          </div>
          <p className="text-sm text-muted-foreground">
            No active routine. Start one to track your {programLength}-day program.
          </p>
        </div>
      ) : null}
    </div>
  );
}
