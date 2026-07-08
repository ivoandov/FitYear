"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { startOfWeek, isAfter, isSameDay, addDays, format } from "date-fns";
import { Check } from "lucide-react";
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
 *   - Weekly tracker card: 7 day cells (M-S) with completions this week vs goal
 *   - Program card: current routine day / programLength (with neon progress bar)
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

  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStartDate, i);
    return {
      label: format(d, "EEEEE"),
      isToday: isSameDay(d, today),
      isCompleted: completedWorkouts.some((w) =>
        isSameDay(new Date(w.completedAt), d),
      ),
    };
  });

  const totalDays = activeRoutine?.durationDays ?? programLength ?? 0;
  const dayNumber = activeRoutine
    ? activeRoutine.completedWorkouts + 1
    : null;
  const programPct =
    activeRoutine && totalDays
      ? Math.min(100, Math.round((activeRoutine.completedWorkouts / totalDays) * 100))
      : 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {daysPerWeek ? (
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="card-elevated w-full p-[18px] text-left"
          data-testid="weekly-target-card"
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-tertiary-foreground">
              This week
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="font-mono text-[20px] font-bold leading-none text-foreground">
                {completedThisWeek}
              </span>
              <span className="font-mono text-[13px] text-tertiary-foreground">
                / {daysPerWeek} days
              </span>
            </span>
          </div>
          <div className="flex justify-between gap-1.5">
            {weekDays.map((d, i) => (
              <div key={i} className="flex flex-col items-center gap-[7px]">
                <span
                  className={`font-mono text-[10px] ${
                    d.isToday ? "text-primary" : "text-tertiary-foreground"
                  }`}
                >
                  {d.label}
                </span>
                <div
                  className={
                    d.isCompleted
                      ? "flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary"
                      : d.isToday
                        ? "h-8 w-8 rounded-[10px] border-[1.5px] border-primary bg-primary-dim"
                        : "h-8 w-8 rounded-[10px] bg-white/[0.05]"
                  }
                >
                  {d.isCompleted && (
                    <Check className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={3.5} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </button>
      ) : null}

      {activeRoutine ? (
        <div className="card-elevated p-[18px]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Program · {activeRoutine.routineName}
            </span>
            <span className="shrink-0 font-mono text-[13px] font-bold text-primary">
              {activeRoutine.completedWorkouts} / {totalDays}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-primary shadow-[0_0_12px_rgba(229,255,0,0.6)]"
              style={{ width: `${programPct}%` }}
            />
          </div>
        </div>
      ) : programLength ? (
        <div className="card-elevated p-[18px]">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
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
              <span className="font-mono">{n}</span> days
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
