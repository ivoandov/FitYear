"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { startOfWeek, isAfter } from "date-fns";
import { Target, Calendar as CalendarIcon, Pencil } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkout } from "@/context/WorkoutContext";
import { useSettings } from "@/components/SettingsProvider";
import { apiRequest, queryClient } from "@/lib/queryClient";

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

const DAYS_OPTIONS = [2, 3, 4, 5, 6, 7] as const;

/**
 * Renders below the home greeting:
 *   - Weekly target card: completedWorkouts this week / daysPerWeek (clickable to edit)
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

  const [editOpen, setEditOpen] = useState(false);

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
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="rounded-xl border border-border bg-card p-4 space-y-2 text-left transition-colors hover:border-primary/50"
          data-testid="weekly-target-card"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <Target className="h-3.5 w-3.5" />
              Weekly target
            </div>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold tabular-nums">
              {completedThisWeek} <span className="text-muted-foreground text-base">/ {daysPerWeek} days</span>
            </span>
          </div>
          <Progress value={weeklyPct} className="[&>div]:bg-primary" />
        </button>
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

      <WeeklyTargetDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        current={daysPerWeek}
      />
    </div>
  );
}

function WeeklyTargetDialog({
  open,
  onClose,
  current,
}: {
  open: boolean;
  onClose: () => void;
  current: number | null;
}) {
  const [value, setValue] = useState<number>(current ?? 4);

  useEffect(() => {
    if (open) setValue(current ?? 4);
  }, [open, current]);

  const save = useMutation({
    mutationFn: (n: number) =>
      apiRequest("PATCH", "/api/user-settings", {
        onboardingDaysPerWeek: n,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Weekly target</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          How many days per week do you want to train?
        </p>
        <div className="grid grid-cols-3 gap-2">
          {DAYS_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setValue(n)}
              className={`rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                value === n
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:border-primary"
              }`}
            >
              {n} days
            </button>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={() => save.mutate(value)}
            disabled={save.isPending}
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
