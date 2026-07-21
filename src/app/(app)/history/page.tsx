"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { WorkoutHistoryCard } from "@/components/WorkoutHistoryCard";
import { Button } from "@/components/ui/button";
import { Plus, Target, Trophy, BarChart3, Medal, LineChart } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { startOfWeek, startOfMonth, isAfter, isBefore, isEqual, endOfDay } from "date-fns";
import { useWorkout } from "@/context/WorkoutContext";
import { useSettings } from "@/components/SettingsProvider";
import {
  COARSE_MUSCLE_GROUPS,
  SPECIFICS_BY_COARSE,
  expandMuscleLabel,
  resolveMuscle,
  type CoarseGroup,
} from "@/lib/muscle-groups";
import { cn } from "@/lib/utils";
import { useExerciseDetails } from "@/hooks/useExerciseDetails";
import { GoalDialog } from "@/components/GoalDialog";
import { DesktopTopBar } from "@/components/DesktopTopBar";
import { VolumeTrendChart, type VolumePoint } from "@/components/VolumeTrendChart";
import { localDateKey } from "@/lib/date";
import { lbsToDisplay } from "@/lib/units";
import type { ExerciseGoal } from "@/lib/db/schema";

interface RecordRow {
  exerciseId: string;
  name: string | null;
  isAssisted: boolean;
  bestWeightLbs: number;
  best1RMLbs: number | null;
  bestVolumeLbs: number | null;
  lastPerformed: string;
}

// Muscle / goal progress bars: 6-7px neon indicator over a faint white track,
// styled via arbitrary descendant selectors on the base-ui <Progress> so the
// component (and its data-testid + value logic) is untouched.
const BAR_HEIGHT = "[&_[data-slot=progress-track]]:h-[7px]";
const BAR_TRACK = "[&_[data-slot=progress-track]]:bg-white/[0.08]";
const BAR_TRACK_FULL = "[&_[data-slot=progress-track]]:bg-primary";

// Pure range check (module scope so it isn't reallocated per render, and so it's
// safe to use inside the memos below without being a dependency).
function isWithinRange(date: Date, start: Date, end: Date): boolean {
  return (isAfter(date, start) || isEqual(date, start)) && (isBefore(date, end) || isEqual(date, end));
}

export default function HistoryPage() {
  const { completedWorkouts } = useWorkout();
  const { weekStart: weekStartDay } = useSettings();
  const { enrichExercise } = useExerciseDetails();
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<ExerciseGoal | null>(null);
  const [historyTab, setHistoryTab] = useState<"workouts" | "prs">("workouts");

  const { data: goals = [] } = useQuery<ExerciseGoal[]>({ queryKey: ["/api/exercise-goals"] });

  interface PrHistoryRow {
    id: string;
    exerciseId: string;
    exerciseName: string | null;
    workoutId: string;
    prType: "weight" | "volume";
    newValue: number;
    previousValue: number | null;
    achievedAt: string;
  }
  const { data: prHistoryRows = [] } = useQuery<PrHistoryRow[]>({
    queryKey: ["/api/pr-history?limit=5"],
  });

  const { data: userSettings } = useQuery<{ weightUnit?: "lbs" | "kg" }>({
    queryKey: ["/api/user-settings"],
  });
  const weightUnit = userSettings?.weightUnit ?? "lbs";

  // Phase-4 analytics (SQL over the normalized tables): weekly volume trend +
  // all-time per-exercise records (server-side PR detection).
  const { data: volumeTrend = [] } = useQuery<VolumePoint[]>({
    queryKey: ["/api/analytics/volume-trend"],
  });
  const { data: records = [] } = useQuery<RecordRow[]>({
    queryKey: ["/api/analytics/records?limit=8"],
  });

  const historyData = useMemo(() => completedWorkouts.map((workout, index) => {
    let workoutVolume = 0;
    let totalSets = 0;

    const exercises = workout.exercises.map((ex: any) => {
      const enrichedEx = enrichExercise({ ...ex, id: ex.id || "" });
      const sets = ex.setsData || [];
      sets.forEach((set: any) => {
        const hasData = (set.weight != null && set.reps) || (set.distance && set.time);
        if (hasData || set.completed) {
          if (set.weight != null && set.reps) {
            workoutVolume += set.weight * set.reps;
          }
          totalSets++;
        }
      });
      return {
        id: enrichedEx.id,
        name: enrichedEx.name,
        muscleGroups: enrichedEx.muscleGroups || [],
        exerciseType: enrichedEx.exerciseType,
        sets,
      };
    });

    return {
      id: `${workout.displayId}-${index}`,
      workoutId: workout.id,
      workoutName: workout.name,
      date: workout.completedAt,
      duration: 0,
      exerciseCount: workout.exercises.length,
      totalVolume: workoutVolume,
      totalSets,
      exercises,
      calendarEventId: workout.calendarEventId,
    };
  }), [completedWorkouts, enrichExercise]);

  // Recompute the date boundaries only when the local day (or the week-start
  // setting) changes, not on every render. Previously these were fresh Date
  // objects each render and were used as memo deps below, so the expensive
  // aggregations (weekly muscle sets, goal progress) never hit their cache.
  const dayKey = localDateKey(new Date());
  const { todayEnd, calendarWeekStart, monthStart, last7DaysStart } = useMemo(() => {
    const now = new Date();
    const weekStartsOn = weekStartDay === "monday" ? 1 : 0;
    const last7 = new Date(now);
    last7.setDate(last7.getDate() - 6);
    last7.setHours(0, 0, 0, 0);
    return {
      todayEnd: endOfDay(now),
      calendarWeekStart: startOfWeek(now, { weekStartsOn }),
      monthStart: startOfMonth(now),
      last7DaysStart: last7,
    };
  }, [dayKey, weekStartDay]);

  const workoutsThisWeek = historyData.filter((w) =>
    isWithinRange(w.date, calendarWeekStart, todayEnd)
  ).length;

  const workoutsThisMonth = historyData.filter((w) =>
    isWithinRange(w.date, monthStart, todayEnd)
  ).length;

  const totalWorkouts = historyData.length;
  const totalVolume = historyData.reduce((sum, w) => sum + w.totalVolume, 0);
  const totalSetsCompleted = historyData.reduce((sum, w) => sum + w.totalSets, 0);

  // Sets this week rolled up to the COARSE taxonomy (the main groups are the
  // default view; a persisted Detailed toggle expands each group into its
  // observed specifics - mirrors the exercise-picker MuscleFilterChips model).
  // Unmatched muscle strings quarantine (dropped), per the taxonomy rules.
  const weeklySetsByMuscleGroup = useMemo(() => {
    const coarseSets = new Map<CoarseGroup, number>();
    const specificSets = new Map<CoarseGroup, Map<string, number>>();

    historyData.forEach((workout) => {
      if (!isWithinRange(workout.date, last7DaysStart, todayEnd)) return;
      workout.exercises?.forEach((exercise) => {
        const setCount = exercise.sets?.filter((s: any) =>
          (s.weight != null && s.reps) || (s.distance && s.time) || s.completed
        ).length || 0;
        exercise.muscleGroups?.forEach((muscle: string) => {
          // Expand nested tags first, then resolve; count each raw tag's
          // coarse group ONCE even if it expands to several specifics.
          const resolved = expandMuscleLabel(muscle)
            .map(resolveMuscle)
            .filter((r): r is NonNullable<ReturnType<typeof resolveMuscle>> => r !== null);
          const touchedCoarse = new Set(resolved.map((r) => r.coarse));
          touchedCoarse.forEach((c) => {
            coarseSets.set(c, (coarseSets.get(c) || 0) + setCount);
          });
          resolved.forEach((r) => {
            if (r.label === r.coarse) return;
            if (!specificSets.has(r.coarse)) specificSets.set(r.coarse, new Map());
            const m = specificSets.get(r.coarse)!;
            m.set(r.label, (m.get(r.label) || 0) + setCount);
          });
        });
      });
    });

    return COARSE_MUSCLE_GROUPS.map((coarse) => ({
      muscleGroup: coarse as string,
      sets: coarseSets.get(coarse) || 0,
      maxSets: 20,
      // Observed specifics in the taxonomy's canonical order.
      specifics: SPECIFICS_BY_COARSE[coarse]
        .filter((s) => specificSets.get(coarse)?.has(s))
        .map((s) => ({ label: s, sets: specificSets.get(coarse)!.get(s)! })),
    }));
  }, [historyData, last7DaysStart, todayEnd]);

  // Persisted Groups/Detailed view for the by-muscle card (own key, same
  // pattern as the picker's fy-picker-detailed).
  const [muscleDetailed, setMuscleDetailed] = useState(false);
  useEffect(() => {
    setMuscleDetailed(localStorage.getItem("fy-history-muscle-detailed") === "1");
  }, []);
  const toggleMuscleDetailed = (d: boolean) => {
    setMuscleDetailed(d);
    try {
      localStorage.setItem("fy-history-muscle-detailed", d ? "1" : "0");
    } catch {
      /* private mode - non-fatal */
    }
  };

  // Calculate rolling 7-day reps per exercise for goals (weekly progress)
  const goalProgress = useMemo(() => {
    const repsByExercise: Record<string, number> = {};
    completedWorkouts.forEach(workout => {
      const date = workout.completedAt instanceof Date ? workout.completedAt : new Date(workout.completedAt as any);
      if (!isWithinRange(date, last7DaysStart, todayEnd)) return;
      workout.exercises.forEach((ex: any) => {
        const setsData: any[] = ex.setsData || [];
        setsData.forEach(set => {
          if (!set.completed) return;
          repsByExercise[ex.id] = (repsByExercise[ex.id] || 0) + (set.reps ?? 0);
        });
      });
    });
    return repsByExercise;
  }, [completedWorkouts, last7DaysStart, todayEnd]);

  // Calculate all-time reps per exercise since each goal's createdAt
  const goalAllTimeProgress = useMemo(() => {
    const repsByGoalId: Record<string, number> = {};
    goals.forEach(goal => {
      // Floor to start of day so workouts done earlier the same day as goal creation count
      const rawStart = goal.createdAt instanceof Date ? goal.createdAt : new Date(goal.createdAt as any);
      const goalStart = new Date(rawStart);
      goalStart.setHours(0, 0, 0, 0);
      let total = 0;
      completedWorkouts.forEach(workout => {
        const date = workout.completedAt instanceof Date ? workout.completedAt : new Date(workout.completedAt as any);
        if (date < goalStart) return;
        workout.exercises.forEach((ex: any) => {
          if (ex.id !== goal.exerciseId) return;
          (ex.setsData || []).forEach((set: any) => {
            if (!set.completed) return;
            total += set.reps ?? 0;
          });
        });
      });
      repsByGoalId[goal.id] = total;
    });
    return repsByGoalId;
  }, [completedWorkouts, goals]);

  const stats = [
    { label: "Total workouts", value: totalWorkouts.toString(), testId: "total-workouts", accent: false },
    { label: "This week", value: workoutsThisWeek.toString(), testId: "this-week", accent: true },
    { label: "This month", value: workoutsThisMonth.toString(), testId: "this-month", accent: false },
    { label: "Total sets", value: totalSetsCompleted.toString(), testId: "total-sets", accent: false },
  ];

  const tabControl = (
    <div className="inline-flex gap-1 rounded-[11px] border bg-input p-[3px]" role="tablist">
      {([
        { key: "workouts", label: "Workouts" },
        { key: "prs", label: "PRs" },
      ] as const).map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={historyTab === t.key}
          onClick={() => setHistoryTab(t.key)}
          className={`rounded-[8px] px-3.5 py-1.5 text-xs transition-colors ${
            historyTab === t.key
              ? "border border-strong bg-white/[0.08] font-bold text-foreground"
              : "border border-transparent font-semibold text-tertiary-foreground hover:text-foreground"
          }`}
          data-testid={`tab-history-${t.key}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex-1 overflow-auto h-full">
      <DesktopTopBar title="History">{tabControl}</DesktopTopBar>
      <div className="mx-auto w-full max-w-2xl px-5 py-6 pb-12 space-y-5 md:max-w-6xl md:px-9 md:pt-7">
        {/* Title (mobile only; desktop shows it in the top bar). The Insights
            link is the mobile entry to /insights - desktop reaches it from the
            sidebar rail, so this link is md:hidden. */}
        <div className="flex items-start justify-between gap-3 md:hidden">
          <div>
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]" data-testid="text-page-title">
              History
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Your progress at a glance
            </p>
          </div>
          <Link
            href="/insights"
            data-testid="link-insights"
            className="mt-1 flex shrink-0 items-center gap-1.5 rounded-xl border bg-white/[0.03] px-3.5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            <LineChart className="h-3.5 w-3.5 text-primary" />
            Insights
          </Link>
        </div>

        {/* Desktop dashboard: stats + goals + muscle chart on the left, the
            Workouts/PRs session list on the right (lg+); stacks below lg. */}
        <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-6 lg:space-y-0">
          <div className="space-y-5">
        {/* 2×2 stat tiles */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="card-elevated p-4" data-testid={`card-stat-${stat.testId}`}>
              <div
                className={`font-mono text-[28px] font-bold leading-none ${stat.accent ? "text-primary" : "text-foreground"}`}
                data-testid={`text-stat-value-${stat.testId}`}
              >
                {stat.value}
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-tertiary-foreground">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Weekly Goals */}
        <div className="card-elevated p-5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <Target className="h-3.5 w-3.5 text-primary" />
                Weekly goals · last 7 days
              </div>
              <p className="mt-1 text-xs text-tertiary-foreground">
                Track rep targets across multiple sessions
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setEditingGoal(null); setGoalDialogOpen(true); }}
              data-testid="button-add-goal"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Goal
            </Button>
          </div>
          <div className="mt-4">
            {goals.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No goals yet. Add one to start tracking multi-session progress.
              </p>
            ) : (
              <div className="space-y-4">
                {goals.map(goal => {
                  const done = goalProgress[goal.exerciseId] ?? 0;
                  const allTime = goalAllTimeProgress[goal.id] ?? 0;
                  const pct = Math.min(100, (done / goal.targetReps) * 100);
                  const isComplete = done >= goal.targetReps;
                  const goalStart = goal.createdAt instanceof Date ? goal.createdAt : new Date(goal.createdAt as any);
                  const startLabel = goalStart.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <button
                      key={goal.id}
                      className="w-full text-left space-y-1.5 hover-elevate rounded-md p-1 -m-1"
                      onClick={() => { setEditingGoal(goal); setGoalDialogOpen(true); }}
                      data-testid={`row-goal-${goal.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">{goal.exerciseName}</span>
                        <span className={`shrink-0 font-mono text-xs ${isComplete ? "text-primary" : "text-tertiary-foreground"}`}>
                          {done}/{goal.targetReps}
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        className={`${BAR_HEIGHT} ${isComplete ? BAR_TRACK_FULL : BAR_TRACK}`}
                        data-testid={`progress-goal-${goal.id}`}
                      />
                      <p className="font-mono text-[10px] tracking-[0.04em] text-tertiary-foreground" data-testid={`text-goal-alltime-${goal.id}`}>
                        {allTime.toLocaleString()} total since {startLabel}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sets this week · by muscle. Coarse groups by default; the Detailed
            toggle (picker-style segmented control) expands each group's
            observed specifics as compact sub-rows. */}
        <div className="card-elevated p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Sets this week · by muscle
            </div>
            <div className="inline-flex rounded-lg border p-0.5 font-mono text-[10px]">
              <button
                type="button"
                onClick={() => toggleMuscleDetailed(false)}
                className={cn("rounded-md px-2 py-1 transition-colors", !muscleDetailed ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground")}
                data-testid="history-muscle-view-groups"
              >
                Groups
              </button>
              <button
                type="button"
                onClick={() => toggleMuscleDetailed(true)}
                className={cn("rounded-md px-2 py-1 transition-colors", muscleDetailed ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground")}
                data-testid="history-muscle-view-detailed"
              >
                Detailed
              </button>
            </div>
          </div>
          <div className="space-y-3.5">
            {weeklySetsByMuscleGroup.map((group) => (
              <div key={group.muscleGroup}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[13px] text-foreground" data-testid={`text-muscle-${group.muscleGroup.toLowerCase()}`}>
                    {group.muscleGroup}
                  </span>
                  <span className="font-mono text-xs text-tertiary-foreground" data-testid={`text-sets-${group.muscleGroup.toLowerCase()}`}>
                    {group.sets}/{group.maxSets}
                  </span>
                </div>
                <Progress
                  value={(group.sets / group.maxSets) * 100}
                  className={`${BAR_HEIGHT} ${BAR_TRACK}`}
                  data-testid={`progress-${group.muscleGroup.toLowerCase()}`}
                />
                {muscleDetailed && group.specifics.length > 0 && (
                  <div className="ml-0.5 mt-1.5 space-y-1 border-l border-divider pl-3">
                    {group.specifics.map((s) => (
                      <div key={s.label} className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground" data-testid={`text-muscle-spec-${s.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                          {s.label}
                        </span>
                        <span className="font-mono text-[11px] text-tertiary-foreground">{s.sets}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Training volume trend (SQL, weekly total volume over the last 12 weeks) */}
        <div className="card-elevated p-5" data-testid="card-volume-trend">
          <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
            Training volume · last 12 weeks
          </div>
          <p className="mt-1 text-xs text-tertiary-foreground">
            Total weight moved per week ({weightUnit}), all lifts
          </p>
          <div className="mt-4">
            <VolumeTrendChart data={volumeTrend} weightUnit={weightUnit} />
          </div>
        </div>

          </div>

          {/* Right column: the Workouts | PRs session list. */}
          <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">
              {historyTab === "workouts" ? "Recent" : "Personal Bests"}
            </h2>
            <div className="md:hidden">{tabControl}</div>
          </div>

          {historyTab === "workouts" ? (
            historyData.length > 0 ? (
              <div className="space-y-3">
                {historyData.map((session) => (
                  <WorkoutHistoryCard key={session.id} {...session} />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <p className="text-muted-foreground">No workout history yet</p>
                <p className="mt-2 text-sm text-tertiary-foreground">
                  Complete your first workout to see your progress here
                </p>
              </div>
            )
          ) : prHistoryRows.length > 0 || records.length > 0 ? (
            <div className="space-y-4">
              {prHistoryRows.length > 0 ? (
                <div className="card-elevated p-5">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <Trophy className="h-3.5 w-3.5 text-primary" />
                    Recent personal bests
                  </div>
                  <p className="mt-1 text-xs text-tertiary-foreground">
                    Last {prHistoryRows.length} {prHistoryRows.length === 1 ? "PR" : "PRs"} across all your lifts
                  </p>
                  <div className="mt-4 space-y-3">
                    {prHistoryRows.map((pr) => {
                      const date = new Date(pr.achievedAt);
                      const dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                      return (
                        <div key={pr.id} className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <span className="shrink-0 text-base">
                              {pr.prType === "weight" ? "🏆" : "⭐"}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-foreground">{pr.exerciseName ?? "Unknown exercise"}</div>
                              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em]">
                                <span className={pr.prType === "weight" ? "text-primary" : "text-success"}>
                                  {pr.prType}
                                </span>
                                <span className="text-tertiary-foreground">{" · "}{dateLabel}</span>
                              </div>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono text-sm font-bold text-foreground">
                              {pr.prType === "weight" ? `${pr.newValue} lb` : `${pr.newValue.toLocaleString()} vol`}
                            </div>
                            {pr.previousValue != null ? (
                              <div className="font-mono text-[10px] text-tertiary-foreground">
                                was {pr.prType === "weight" ? `${pr.previousValue} lb` : pr.previousValue.toLocaleString()}
                              </div>
                            ) : (
                              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-tertiary-foreground">first time</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {records.length > 0 ? (
                <div className="card-elevated p-5" data-testid="card-records">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <Medal className="h-3.5 w-3.5 text-primary" />
                    All-time records
                  </div>
                  <p className="mt-1 text-xs text-tertiary-foreground">
                    Your best set per exercise, from every logged set
                  </p>
                  <div className="mt-4 space-y-3">
                    {records.map((r) => (
                      <div key={r.exerciseId} className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {r.name ?? "Exercise"}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
                            {r.isAssisted
                              ? "assisted · least assist"
                              : r.best1RMLbs
                                ? `est 1RM ${lbsToDisplay(r.best1RMLbs, weightUnit)} ${weightUnit}`
                                : "best set"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-sm font-bold text-foreground">
                            {lbsToDisplay(r.bestWeightLbs, weightUnit)} {weightUnit}
                          </div>
                          {!r.isAssisted && r.bestVolumeLbs ? (
                            <div className="font-mono text-[10px] text-tertiary-foreground">
                              {Math.round(lbsToDisplay(r.bestVolumeLbs, weightUnit) ?? 0).toLocaleString()} vol
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-12 text-center">
              <p className="text-muted-foreground">No personal bests yet</p>
              <p className="mt-2 text-sm text-tertiary-foreground">
                Hit a new weight or volume PR during a workout and it&apos;ll show up here
              </p>
            </div>
          )}
          </div>
        </div>
      </div>

      <GoalDialog
        isOpen={goalDialogOpen}
        onClose={() => { setGoalDialogOpen(false); setEditingGoal(null); }}
        editGoal={editingGoal}
      />
    </div>
  );
}
