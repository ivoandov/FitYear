"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkoutHistoryCard } from "@/components/WorkoutHistoryCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Calendar, Flame, Activity, Plus, Target, Trophy } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { startOfWeek, startOfMonth, isAfter, isBefore, isEqual, endOfDay } from "date-fns";
import { useWorkout } from "@/context/WorkoutContext";
import { useSettings } from "@/components/SettingsProvider";
import { useExerciseDetails } from "@/hooks/useExerciseDetails";
import { GoalDialog } from "@/components/GoalDialog";
import type { ExerciseGoal } from "@/lib/db/schema";

export default function HistoryPage() {
  const { completedWorkouts } = useWorkout();
  const { weekStart: weekStartDay, muscleGroups } = useSettings();
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

  const now = new Date();
  const todayEnd = endOfDay(now);
  const weekStartsOn = weekStartDay === "monday" ? 1 : 0;
  const calendarWeekStart = startOfWeek(now, { weekStartsOn });
  const monthStart = startOfMonth(now);
  
  const last7DaysStart = new Date(now);
  last7DaysStart.setDate(last7DaysStart.getDate() - 6);
  last7DaysStart.setHours(0, 0, 0, 0);

  const isWithinRange = (date: Date, start: Date, end: Date) => {
    return (isAfter(date, start) || isEqual(date, start)) && (isBefore(date, end) || isEqual(date, end));
  };

  const workoutsThisWeek = historyData.filter((w) =>
    isWithinRange(w.date, calendarWeekStart, todayEnd)
  ).length;

  const workoutsThisMonth = historyData.filter((w) =>
    isWithinRange(w.date, monthStart, todayEnd)
  ).length;

  const totalWorkouts = historyData.length;
  const totalVolume = historyData.reduce((sum, w) => sum + w.totalVolume, 0);
  const totalSetsCompleted = historyData.reduce((sum, w) => sum + w.totalSets, 0);

  const calculateWeeklySetsByMuscle = () => {
    const setsByMuscle: { [key: string]: number } = {};

    historyData.forEach((workout) => {
      if (isWithinRange(workout.date, last7DaysStart, todayEnd)) {
        workout.exercises?.forEach((exercise) => {
          const setCount = exercise.sets?.filter((s: any) => 
            (s.weight != null && s.reps) || (s.distance && s.time) || s.completed
          ).length || 0;
          exercise.muscleGroups?.forEach((muscle: string) => {
            setsByMuscle[muscle] = (setsByMuscle[muscle] || 0) + setCount;
          });
        });
      }
    });

    const allMuscleGroups = new Set([...muscleGroups, ...Object.keys(setsByMuscle)]);
    return Array.from(allMuscleGroups).map((muscle) => ({
      muscleGroup: muscle,
      sets: setsByMuscle[muscle] || 0,
      maxSets: 20,
    }));
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

  const weeklySetsByMuscleGroup = calculateWeeklySetsByMuscle();

  const stats = [
    { label: "Total Workouts", value: totalWorkouts.toString(), icon: Calendar, testId: "total-workouts" },
    { label: "This Week", value: workoutsThisWeek.toString(), icon: Flame, testId: "this-week" },
    { label: "This Month", value: workoutsThisMonth.toString(), icon: Activity, testId: "this-month" },
    { label: "Total Sets", value: totalSetsCompleted.toString(), icon: TrendingUp, testId: "total-sets" },
  ];

  return (
    <div className="flex-1 overflow-auto h-full">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-8 sm:pb-12 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">
            Workout History
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track your progress and review past sessions
          </p>
        </div>

        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <Card key={stat.label} data-testid={`card-stat-${stat.testId}`}>
              <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 p-3 sm:p-4 pb-1 sm:pb-2">
                <CardTitle className="text-xs sm:text-sm font-medium">
                  {stat.label}
                </CardTitle>
                <stat.icon className="h-3 w-3 sm:h-4 sm:w-4 text-muted-foreground flex-shrink-0" />
              </CardHeader>
              <CardContent className="p-3 sm:p-4 pt-0">
                <div className="text-xl sm:text-2xl font-bold" data-testid={`text-stat-value-${stat.testId}`}>
                  {stat.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Weekly Goals */}
        <Card>
          <CardHeader className="p-4 sm:p-6 pb-3 sm:pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Weekly Goals (last 7 days)
                </CardTitle>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
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
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            {goals.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
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
                      <div className="flex items-center justify-between text-xs sm:text-sm gap-2">
                        <span className="font-medium truncate">{goal.exerciseName}</span>
                        <span className={`shrink-0 tabular-nums ${isComplete ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                          {done} / {goal.targetReps} this week
                        </span>
                      </div>
                      <Progress
                        value={pct}
                        className={isComplete ? "[&>div]:bg-primary" : ""}
                        data-testid={`progress-goal-${goal.id}`}
                      />
                      <p className="text-xs text-muted-foreground" data-testid={`text-goal-alltime-${goal.id}`}>
                        {allTime.toLocaleString()} total since {startLabel}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Weekly Sets by Muscle Group (last 7 days)</CardTitle>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Track your training volume across different muscle groups
            </p>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            <div className="space-y-3 sm:space-y-4">
              {weeklySetsByMuscleGroup.map((group) => (
                <div key={group.muscleGroup} className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <span className="font-medium" data-testid={`text-muscle-${group.muscleGroup.toLowerCase()}`}>
                      {group.muscleGroup}
                    </span>
                    <span className="text-muted-foreground" data-testid={`text-sets-${group.muscleGroup.toLowerCase()}`}>
                      {group.sets}/{group.maxSets}
                    </span>
                  </div>
                  <Progress
                    value={(group.sets / group.maxSets) * 100}
                    data-testid={`progress-${group.muscleGroup.toLowerCase()}`}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Segmented tab control: Workouts | Personal Bests */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg sm:text-xl font-semibold">
              {historyTab === "workouts" ? "Recent Workouts" : "Personal Bests"}
            </h2>
            <div className="inline-flex rounded-[10px] border bg-input p-1 gap-1" role="tablist">
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
                  className={`px-3 h-7 rounded-[8px] text-xs font-semibold transition-colors ${
                    historyTab === t.key
                      ? "bg-white/[0.06] border border-strong text-foreground"
                      : "text-muted-foreground hover:text-foreground border border-transparent"
                  }`}
                  data-testid={`tab-history-${t.key}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {historyTab === "workouts" ? (
            historyData.length > 0 ? (
              <div className="space-y-3 sm:space-y-4">
                {historyData.map((session) => (
                  <WorkoutHistoryCard key={session.id} {...session} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No workout history yet</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Complete your first workout to see your progress here
                </p>
              </div>
            )
          ) : prHistoryRows.length > 0 ? (
            <Card>
              <CardHeader className="p-4 sm:p-6 pb-3 sm:pb-4">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  Recent personal bests
                </CardTitle>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  Last {prHistoryRows.length} {prHistoryRows.length === 1 ? "PR" : "PRs"} across all your lifts
                </p>
              </CardHeader>
              <CardContent className="p-4 sm:p-6 pt-0 space-y-3">
                {prHistoryRows.map((pr) => {
                  const date = new Date(pr.achievedAt);
                  const dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  return (
                    <div key={pr.id} className="flex items-start justify-between gap-2 text-sm">
                      <div className="flex items-start gap-2 min-w-0">
                        <span className="text-base shrink-0">
                          {pr.prType === "weight" ? "🏆" : "⭐"}
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{pr.exerciseName ?? "Unknown exercise"}</div>
                          <div className="text-xs text-muted-foreground">
                            <span className={`uppercase tracking-wide font-semibold ${pr.prType === "weight" ? "text-primary" : "text-emerald-500"}`}>
                              {pr.prType}
                            </span>
                            {" · "}{dateLabel}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 tabular-nums">
                        <div className="font-semibold">
                          {pr.prType === "weight" ? `${pr.newValue} lbs` : `${pr.newValue.toLocaleString()} vol`}
                        </div>
                        {pr.previousValue != null ? (
                          <div className="text-xs text-muted-foreground">
                            was {pr.prType === "weight" ? `${pr.previousValue} lbs` : pr.previousValue.toLocaleString()}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">first time</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No personal bests yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Hit a new weight or volume PR during a workout and it'll show up here
              </p>
            </div>
          )}
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