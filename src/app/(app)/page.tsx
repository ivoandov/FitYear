"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWorkoutMutations } from "@/hooks/use-workout-mutations";
import { WorkoutEditorDialog, type WorkoutData } from "@/components/WorkoutEditorDialog";
import { Button } from "@/components/ui/button";
import { Plus, Calendar as CalendarIcon, Pencil, Trash2, Play, Check, Dumbbell, Link2, Sparkles, ChevronRight, ClipboardList } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, addDays, isBefore, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoreVertical, Settings, LogOut } from "lucide-react";
import { type Exercise } from "@/data/exercises";
import { useWorkout } from "@/context/WorkoutContext";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { localDateKey } from "@/lib/date";
import { setWorkoutPreview } from "@/lib/workout-preview";
import { GoalsStrip } from "@/components/GoalsStrip";
import { WorkoutCardMenu } from "@/components/WorkoutCardMenu";
import { ScheduledWorkoutCard } from "@/components/ScheduledWorkoutCard";

interface ScheduledWorkout {
  id: string;
  name: string;
  date: Date;
  exercises: Exercise[];
  templateId?: string;
  routineInstanceId?: string | null;
}

interface WorkoutTemplate {
  id: string;
  name: string;
  exercises: Exercise[];
}

interface DBScheduledWorkout {
  id: string;
  name: string;
  date: string;
  exercises: any;
  templateId?: string;
  routineInstanceId?: string | null;
}

interface DBWorkoutTemplate {
  id: string;
  name: string;
  exercises: any;
}

interface DBExercise {
  id: string;
  name: string;
  muscleGroups: string[];
  description: string;
  imageUrl: string | null;
  exerciseType: string | null;
}

interface DBRoutineInstance {
  id: string;
  routineId: string;
  userId: string;
  routineName: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  totalWorkouts: number;
  completedWorkouts: number;
  skippedWorkouts: number;
  status: string;
}

export default function WorkoutsPage() {
  const router = useRouter();
  const { user, logout, isLoggingOut } = useAuth();
  const firstName = user?.firstName ?? "";
  const initials =
    [user?.firstName, user?.lastName]
      .filter(Boolean)
      .map((n) => n?.[0])
      .join("") ||
    user?.email?.[0]?.toUpperCase() ||
    "?";
  const avatarUrl = user?.profileImageUrl ?? undefined;
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showEditorDialog, setShowEditorDialog] = useState(false);
  const [editingWorkout, setEditingWorkout] = useState<ScheduledWorkout | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [workoutToDelete, setWorkoutToDelete] = useState<{ id: string; name: string; isTemplate?: boolean; isCompleted?: boolean } | null>(null);
  const { toast } = useToast();
  const { startWorkout, startEmptyWorkout, isWorkoutCompleted, completedWorkouts, restartWorkout, updateCompletedWorkout, deleteCompletedWorkout } = useWorkout();
  const [editingCompletedWorkout, setEditingCompletedWorkout] = useState<{ id: string; name: string; exercises: Exercise[] } | null>(null);
  const [scheduleAgainWorkout, setScheduleAgainWorkout] = useState<{ name: string; exercises: Exercise[]; templateId?: string } | null>(null);
  const [scheduleAgainDate, setScheduleAgainDate] = useState<Date>(new Date());
  const [updateFutureTemplateId, setUpdateFutureTemplateId] = useState<string | null>(null);
  const [isUpdatingFuture, setIsUpdatingFuture] = useState(false);

  const { data: dbWorkouts = [], isLoading, isError, error } = useQuery<DBScheduledWorkout[]>({
    queryKey: ["/api/scheduled-workouts"],
  });

  const { data: dbTemplates = [], isLoading: isLoadingTemplates } = useQuery<DBWorkoutTemplate[]>({
    queryKey: ["/api/workout-templates"],
  });

  const { data: dbExercises = [] } = useQuery<DBExercise[]>({
    queryKey: ["/api/exercises"],
  });

  // Defer secondary/below-fold queries (routine-usage badges + routine
  // instances) until the page is idle, so the primary content — scheduled
  // workouts, templates, history — wins network bandwidth first on a cold
  // mobile load (avoids ~9 requests contending at once). Cached values (from
  // the persisted query cache) still render immediately; this only gates the
  // network fetch, not the read.
  const [deferSecondary, setDeferSecondary] = useState(false);
  useEffect(() => {
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setDeferSecondary(true), { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = setTimeout(() => setDeferSecondary(true), 600);
    return () => clearTimeout(id);
  }, []);

  const { data: templateRoutineUsage = {} } = useQuery<Record<string, string[]>>({
    queryKey: ["/api/workout-templates/routine-usage"],
    enabled: deferSecondary,
  });

  const { data: dbRoutineInstances = [] } = useQuery<DBRoutineInstance[]>({
    queryKey: ["/api/routine-instances"],
    enabled: deferSecondary,
  });

  const routineInstanceMap = new Map<string, string>(
    dbRoutineInstances.map(ri => [ri.id, ri.routineName])
  );

  const activeRoutineInstances = dbRoutineInstances.filter(
    (ri) => ri.status === "active",
  );

  // Compute "Day X of Y · Routine Name" for the hero card when this workout
  // belongs to an active routine instance.
  function activeRoutineForHero(
    hero: { routineInstanceId?: string | null },
    instances: DBRoutineInstance[],
  ): {
    dayNumber: number;
    totalDays: number;
    routineName: string;
    completedSoFar: number;
  } | null {
    if (!hero.routineInstanceId) return null;
    const ri = instances.find((x) => x.id === hero.routineInstanceId);
    if (!ri) return null;
    return {
      dayNumber: (ri.completedWorkouts ?? 0) + 1,
      totalDays: ri.totalWorkouts || ri.durationDays,
      routineName: ri.routineName,
      completedSoFar: ri.completedWorkouts ?? 0,
    };
  }

  // These derived lists recompute only when their source query data changes,
  // not on every render (dialog toggles, date selection). getWorkoutImageUrl's
  // per-exercise lookup is backed by exerciseImageById (below) instead of an
  // O(n) find per call.
  const allAvailableExercises = useMemo<Exercise[]>(
    () =>
      dbExercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        muscleGroups: ex.muscleGroups,
        description: ex.description,
        imageUrl: ex.imageUrl || undefined,
        exerciseType: (ex.exerciseType as "weight_reps" | "distance_time") || "weight_reps",
      })),
    [dbExercises],
  );

  const scheduledWorkouts = useMemo<ScheduledWorkout[]>(
    () =>
      dbWorkouts.map((w) => {
        // Parse date as UTC and create a local date with the same calendar date
        // This prevents timezone shift (e.g., UTC midnight becoming previous day in local time)
        const utcDate = new Date(w.date);
        const localDate = new Date(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());

        return {
          id: w.id,
          name: w.name,
          date: localDate,
          exercises: (w.exercises as any[]).map((ex: any) => ({
            ...ex,
            muscleGroups: ex.muscleGroups || [],
          })) as Exercise[],
          templateId: w.templateId,
          routineInstanceId: w.routineInstanceId,
        };
      }),
    [dbWorkouts],
  );

  const workoutTemplates = useMemo<WorkoutTemplate[]>(
    () =>
      dbTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        exercises: (t.exercises as any[]).map((ex: any) => ({
          ...ex,
          muscleGroups: ex.muscleGroups || [],
        })) as Exercise[],
      })),
    [dbTemplates],
  );

  // exerciseId -> imageUrl, so getWorkoutImageUrl is O(1) per exercise.
  const exerciseImageById = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const ex of allAvailableExercises) m.set(ex.id, ex.imageUrl ?? undefined);
    return m;
  }, [allAvailableExercises]);

  const originalWorkoutIds = useMemo(() => {
    const ids = new Set<string>();
    const templateGroups = new Map<string, ScheduledWorkout[]>();
    for (const w of scheduledWorkouts) {
      if (w.templateId && !w.routineInstanceId) {
        const group = templateGroups.get(w.templateId) || [];
        group.push(w);
        templateGroups.set(w.templateId, group);
      }
    }
    templateGroups.forEach((workouts) => {
      if (workouts.length > 1) {
        workouts.sort((a, b) => a.date.getTime() - b.date.getTime());
        ids.add(workouts[0].id);
      }
    });
    return ids;
  }, [scheduledWorkouts]);

  const getTemplateCompletionCount = (templateId: string): number => {
    return completedWorkouts.filter(w => w.templateId === templateId).length;
  };

  const {
    createTemplateMutation,
    updateTemplateMutation,
    deleteTemplateMutation,
    createMutation,
    updateMutation,
    deleteMutation,
    skipWorkoutMutation,
  } = useWorkoutMutations();

  const handleSkipWorkout = (workoutId: string) => {
    skipWorkoutMutation.mutate(workoutId);
  };

  const handleStartWorkout = (workoutId: string) => {
    const workout = scheduledWorkouts.find(w => w.id === workoutId);
    if (workout) {
      setWorkoutPreview({
        id: workout.id,
        displayId: workoutId,
        scheduledWorkoutId: workout.id,
        name: workout.name,
        exercises: workout.exercises,
      });
      router.push("/workout-preview");
    }
  };

  // Schedule the recurring instances of a workout from data.date, spaced by the
  // repeat interval (daily=7 occurrences, else 4). Returns the count scheduled.
  // The caller owns query invalidation + the success toast (they differ per
  // flow). Was duplicated verbatim in two handleSaveWorkout branches.
  const scheduleRecurring = async (data: WorkoutData, templateId: string): Promise<number> => {
    const intervalDays = data.repeatType === "daily" ? 1
      : data.repeatType === "weekly" ? 7
      : (data.repeatInterval || 1);
    const numOccurrences = data.repeatType === "daily" ? 7 : 4;
    for (let i = 0; i < numOccurrences; i++) {
      const workoutDate = addDays(data.date, intervalDays * i);
      await apiRequest("POST", "/api/scheduled-workouts", {
        name: data.name,
        date: workoutDate.toISOString(),
        localDate: localDateKey(workoutDate),
        exercises: data.exercises,
        templateId,
      });
    }
    return numOccurrences;
  };

  const handleSaveWorkout = async (data: WorkoutData) => {
    if (editingCompletedWorkout) {
      updateCompletedWorkout(editingCompletedWorkout.id, data.name, data.exercises, data.date);
      
      // If repeat is set, schedule future workouts
      if (data.repeatType && data.repeatType !== "none") {
        try {
          // First, create or find a template for this workout
          const templateRes = await apiRequest("POST", "/api/workout-templates", {
            name: data.name,
            exercises: data.exercises,
          });
          const template = await templateRes.json();

          const numOccurrences = await scheduleRecurring(data, template.id);

          queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
          queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });

          toast({
            title: "Workout Updated & Scheduled",
            description: `${data.name} updated and ${numOccurrences} future workouts scheduled.`,
          });
        } catch (error) {
          console.error("Failed to schedule recurring workouts:", error);
          toast({
            title: "Workout Updated",
            description: `${data.name} updated, but failed to schedule recurring workouts.`,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Workout Updated",
          description: `${data.name} has been updated successfully.`,
        });
      }
      setEditingCompletedWorkout(null);
    } else if (editingTemplateId) {
      // Editing an existing template - use mutateAsync to await result
      const templateId = editingTemplateId;
      setEditingTemplateId(null);
      try {
        await updateTemplateMutation.mutateAsync({
          id: templateId,
          name: data.name,
          exercises: data.exercises,
        });
        toast({
          title: "Workout Updated",
          description: `${data.name} has been updated successfully.`,
        });
        // Check if there are future scheduled workouts with this template
        const hasFutureScheduled = scheduledWorkouts.some(
          w => w.templateId === templateId && w.date > new Date()
        );
        if (hasFutureScheduled) {
          setUpdateFutureTemplateId(templateId);
        }
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to update workout. Please try again.",
          variant: "destructive",
        });
      }
    } else if (data.id) {
      // Editing an existing scheduled workout
      updateMutation.mutate({
        id: data.id,
        name: data.name,
        date: data.date,
        exercises: data.exercises,
      });
      toast({
        title: "Workout Updated",
        description: `${data.name} has been updated successfully.`,
      });
    } else {
      // Create both a template AND schedule the workout(s)
      try {
        const templateRes = await apiRequest("POST", "/api/workout-templates", {
          name: data.name,
          exercises: data.exercises,
        });
        const template = await templateRes.json();

        if (data.repeatType && data.repeatType !== "none") {
          const numOccurrences = await scheduleRecurring(data, template.id);

          queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });

          toast({
            title: "Workout Created",
            description: `${data.name} scheduled with ${numOccurrences} occurrences.`,
          });
        } else {
          // Single workout
          createMutation.mutate({
            name: data.name,
            date: data.date,
            exercises: data.exercises,
            templateId: template.id,
          });
          
          toast({
            title: "Workout Created",
            description: `${data.name} scheduled for ${format(data.date, "PPP")}`,
          });
        }
        
        queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
      } catch (error) {
        console.error("Failed to create workout:", error);
        toast({
          title: "Error",
          description: "Failed to create workout. Please try again.",
          variant: "destructive",
        });
      }
    }
    setEditingWorkout(null);
  };

  const handleEditWorkout = (workoutId: string) => {
    const workout = scheduledWorkouts.find(w => w.id === workoutId);
    if (workout) {
      setEditingWorkout(workout);
      setShowEditorDialog(true);
    }
  };

  const handleDeleteWorkout = (workoutId: string, workoutName: string) => {
    setWorkoutToDelete({ id: workoutId, name: workoutName });
  };

  const confirmDeleteWorkout = () => {
    if (workoutToDelete) {
      if (workoutToDelete.isTemplate) {
        deleteTemplateMutation.mutate(workoutToDelete.id);
      } else if (workoutToDelete.isCompleted) {
        deleteCompletedWorkout(workoutToDelete.id);
        toast({
          title: "Workout Deleted",
          description: "The completed workout has been removed from your history.",
        });
      } else {
        deleteMutation.mutate(workoutToDelete.id);
        toast({
          title: "Workout Deleted",
          description: "The workout has been removed from your schedule.",
        });
      }
      setWorkoutToDelete(null);
    }
  };

  const handleNewWorkout = () => {
    setEditingWorkout(null);
    setShowEditorDialog(true);
  };

  const handleRestartWorkout = (completedWorkout: typeof completedWorkouts[0]) => {
    setWorkoutPreview({
      id: completedWorkout.id,
      displayId: `${completedWorkout.id}-restart-${Date.now()}`,
      name: completedWorkout.name,
      exercises: completedWorkout.exercises as Exercise[],
    });
    router.push("/workout-preview");
  };

  const handleStartFromTemplate = (templateId: string) => {
    const template = workoutTemplates.find(t => t.id === templateId);
    if (template) {
      setWorkoutPreview({
        id: templateId,
        displayId: `template-${templateId}-${Date.now()}`,
        name: template.name,
        exercises: template.exercises,
      });
      router.push("/workout-preview");
    }
  };

  const handleEditTemplate = (templateId: string) => {
    const template = workoutTemplates.find(t => t.id === templateId);
    if (template) {
      // Track that we're editing a template
      setEditingTemplateId(templateId);
      setEditingWorkout({
        id: template.id,
        name: template.name,
        date: new Date(), // Default to today for the date picker
        exercises: template.exercises,
      });
      setShowEditorDialog(true);
    }
  };

  const handleDeleteTemplate = (templateId: string, templateName: string) => {
    setWorkoutToDelete({ id: templateId, name: templateName, isTemplate: true });
  };

  const handleEditCompletedWorkout = (workout: { id: string; name: string; exercises: Exercise[]; completedAt?: Date | string }) => {
    setEditingCompletedWorkout(workout);
    setEditingWorkout({
      id: workout.id,
      name: workout.name,
      date: workout.completedAt ? new Date(workout.completedAt) : new Date(),
      exercises: workout.exercises,
    });
    setShowEditorDialog(true);
  };

  const handleDeleteCompletedWorkout = (id: string, name: string) => {
    setWorkoutToDelete({ id, name, isTemplate: false, isCompleted: true });
  };

  const handleScheduleAgain = (workout: { name: string; exercises: Exercise[]; templateId?: string | null }) => {
    setScheduleAgainWorkout({ ...workout, templateId: workout.templateId || undefined });
    setScheduleAgainDate(addDays(new Date(), 1)); // Default to tomorrow
  };

  const confirmScheduleAgain = async () => {
    if (scheduleAgainWorkout) {
      const localDate = localDateKey(scheduleAgainDate);
      try {
        await apiRequest("POST", "/api/scheduled-workouts", {
          name: scheduleAgainWorkout.name,
          date: scheduleAgainDate.toISOString(),
          localDate,
          exercises: scheduleAgainWorkout.exercises,
          templateId: scheduleAgainWorkout.templateId,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
        toast({
          title: "Workout Scheduled",
          description: `${scheduleAgainWorkout.name} scheduled for ${format(scheduleAgainDate, "PPP")}`,
        });
      } catch (error) {
        console.error("Failed to schedule workout:", error);
        toast({
          title: "Error",
          description: "Failed to schedule workout. Please try again.",
          variant: "destructive",
        });
      }
      setScheduleAgainWorkout(null);
    }
  };

  const confirmUpdateFutureScheduled = async () => {
    if (updateFutureTemplateId) {
      setIsUpdatingFuture(true);
      try {
        const res = await apiRequest("POST", `/api/workout-templates/${updateFutureTemplateId}/update-future-scheduled`, {});
        const result = await res.json();
        queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
        toast({
          title: "Future Workouts Updated",
          description: `Updated ${result.updatedCount} future scheduled workout(s).`,
        });
      } catch (error) {
        console.error("Failed to update future scheduled workouts:", error);
        toast({
          title: "Error",
          description: "Failed to update future scheduled workouts.",
          variant: "destructive",
        });
      } finally {
        setIsUpdatingFuture(false);
        setUpdateFutureTemplateId(null);
      }
    }
  };

  const displayedWorkouts = useMemo(
    () =>
      scheduledWorkouts
        .map((workout) => ({ ...workout, displayId: workout.id }))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [scheduledWorkouts],
  );

  const todayKey = format(new Date(), "yyyy-MM-dd");
  const todayWorkouts = useMemo(
    () => displayedWorkouts.filter((w) => format(w.date, "yyyy-MM-dd") === todayKey),
    [displayedWorkouts, todayKey],
  );
  const upcomingWorkouts = useMemo(
    () => displayedWorkouts.filter((w) => format(w.date, "yyyy-MM-dd") !== todayKey),
    [displayedWorkouts, todayKey],
  );

  const getWorkoutImageUrl = (exercises: Exercise[]) => {
    for (const ex of exercises) {
      const sourceImage = exerciseImageById.get(ex.id);
      if (sourceImage) return sourceImage;
      if (ex.imageUrl) return ex.imageUrl;
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto h-full">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-8 sm:pb-12">
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading workouts...</p>
          </div>
        </div>
      </div>
    );
  }

  // Explicit error state: without this a failed /api/scheduled-workouts fetch
  // fell through to the empty "No workouts scheduled" state, which could lead a
  // user to recreate data they hadn't actually lost. Offer a retry instead.
  if (isError) {
    return (
      <div className="flex-1 overflow-auto h-full">
        <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-8 sm:pb-12">
          <div className="text-center py-12 space-y-4">
            <p className="text-destructive" data-testid="text-workouts-error">
              Couldn&apos;t load your workouts. {describeApiError(error)}
            </p>
            <Button
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] })}
              data-testid="button-retry-workouts"
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto h-full">
      <div className="mx-auto w-full max-w-xl space-y-6 px-5 pt-3 pb-8">
        {/* Header: mono neon eyebrow + greeting + avatar account menu. On mobile
            the global AppHeader is hidden (each screen owns its header), so the
            avatar is the account access point (Settings / Log out). */}
        <header className="flex items-center justify-between">
          <div>
            <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
              Ready to train
            </div>
            <h1
              className="text-[26px] font-bold leading-none tracking-[-0.02em]"
              data-testid="text-page-title"
            >
              Let&apos;s go{firstName ? `, ${firstName}` : ""}
            </h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-strong bg-card text-[15px] font-bold text-primary"
                data-testid="button-account-menu"
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push("/settings")} data-testid="menu-settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => logout()}
                disabled={isLoggingOut}
                data-testid="menu-logout"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {isLoggingOut ? "Logging out…" : "Log out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <GoalsStrip />

        {/* TODAY eyebrow row: calendar picker + new-workout affordance. */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-tertiary-foreground">
            Today
          </span>
          <div className="flex gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Open calendar"
                  data-testid="button-calendar"
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-xl border border-strong bg-white/[0.03] text-foreground"
                >
                  <CalendarIcon className="h-[17px] w-[17px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={handleNewWorkout}
              aria-label="New workout"
              data-testid="button-new-workout"
              className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-primary-dim text-primary"
            >
              <Plus className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {todayWorkouts.length > 0 ? (
          (() => {
            const firstUncompletedIndex = todayWorkouts.findIndex(w => !isWorkoutCompleted(w.displayId));
            const heroIndex = firstUncompletedIndex >= 0 ? firstUncompletedIndex : 0;
            const heroWorkout = todayWorkouts[heroIndex];
            const remainingWorkouts = todayWorkouts.filter((_, i) => i !== heroIndex);
            const heroImage = getWorkoutImageUrl(heroWorkout.exercises);
            const heroCompleted = isWorkoutCompleted(heroWorkout.displayId);
            const heroPastDue = !heroCompleted && isBefore(startOfDay(heroWorkout.date), startOfDay(new Date()));
            const heroRoutine = activeRoutineForHero(heroWorkout, activeRoutineInstances);

            return (
              <div className="space-y-4">
                <div
                  className="relative overflow-hidden rounded-[20px] bg-card"
                  style={{ minHeight: "340px" }}
                  data-testid={`card-workout-${heroWorkout.displayId}`}
                >
                  {heroImage ? (
                    <>
                      <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/20" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/70 to-black/40" />
                  )}

                  {heroRoutine && (
                    <div className="absolute left-3.5 top-3.5 z-20 rounded-lg border border-yellow bg-black/45 px-2.5 py-1 font-mono text-[11px] font-semibold tracking-[0.1em] text-primary backdrop-blur-sm">
                      DAY {heroRoutine.dayNumber} / {heroRoutine.totalDays}
                    </div>
                  )}

                  <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
                    {heroPastDue && (
                      <Badge variant="outline" className="text-red-500 border-red-500 bg-red-950/50">
                        Past Due
                      </Badge>
                    )}
                    {heroCompleted && (
                      <Badge variant="outline" className="text-green-500 border-green-500 bg-green-950/50">
                        <Check className="h-3 w-3 mr-1" />
                        Done
                      </Badge>
                    )}
                    {heroWorkout.routineInstanceId && (
                      <Badge variant="outline" className="text-primary border-primary/50 bg-black/40">
                        {routineInstanceMap.get(heroWorkout.routineInstanceId) || "Routine"}
                      </Badge>
                    )}
                    <WorkoutCardMenu
                      displayId={heroWorkout.displayId}
                      workoutId={heroWorkout.id}
                      name={heroWorkout.name}
                      templateId={heroWorkout.templateId}
                      routineInstanceId={heroWorkout.routineInstanceId}
                      triggerClassName="text-white"
                      onEdit={handleEditWorkout}
                      onEditTemplate={handleEditTemplate}
                      onSkip={handleSkipWorkout}
                      onDelete={handleDeleteWorkout}
                    />
                  </div>

                  <div className="absolute inset-x-0 bottom-0 z-10 p-5">
                    {heroRoutine && (
                      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/60">
                        {heroRoutine.routineName}
                      </div>
                    )}
                    <h3 className="mb-2 text-[27px] font-bold leading-tight tracking-[-0.01em] text-white">
                      {heroWorkout.name}
                    </h3>
                    <div className="mb-4 font-mono text-[12px] uppercase tracking-[0.04em] text-white/65">
                      {heroWorkout.exercises.length} exercise{heroWorkout.exercises.length === 1 ? "" : "s"}
                    </div>
                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleStartWorkout(heroWorkout.displayId)}
                        data-testid={`button-start-workout-${heroWorkout.displayId}`}
                        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-[15px] font-bold text-primary-foreground shadow-cta-strong"
                      >
                        <Play className="h-[17px] w-[17px] fill-current" />
                        Start
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStartWorkout(heroWorkout.displayId)}
                        aria-label={`Preview ${heroWorkout.name}`}
                        className="flex h-12 items-center justify-center rounded-2xl border border-strong bg-white/[0.06] px-5 text-[15px] font-semibold text-white backdrop-blur-sm"
                      >
                        Preview
                      </button>
                    </div>
                  </div>
                </div>

                {remainingWorkouts.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                    {remainingWorkouts.map((workout) => {
                      const isCompleted = isWorkoutCompleted(workout.displayId);
                      const workoutImage = getWorkoutImageUrl(workout.exercises);
                      return (
                        <ScheduledWorkoutCard
                          key={workout.displayId}
                          workout={workout}
                          imageUrl={workoutImage}
                          onStart={handleStartWorkout}
                          onEdit={handleEditWorkout}
                          onEditTemplate={handleEditTemplate}
                          onSkip={handleSkipWorkout}
                          onDelete={handleDeleteWorkout}
                          badges={
                            isCompleted ? (
                              <Badge variant="outline" className="text-green-500 border-green-500">
                                <Check className="h-3 w-3 mr-1" />
                                Done
                              </Badge>
                            ) : null
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()
        ) : (
          <div className="space-y-4">
            {/* Empty hero: blank-start CTA + FitBot single-workout entry (→ /fit-bot/workout). */}
            <div className="relative flex flex-col items-center overflow-hidden rounded-[20px] border border-dashed border-strong bg-card px-6 pb-7 pt-9 text-center">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(120%_80%_at_50%_0%,rgba(229,255,0,0.06),transparent_60%)]" />
              <div className="relative z-10 flex w-full flex-col items-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-dim">
                  <Dumbbell className="h-8 w-8 text-primary" />
                </div>
                <h3 className="mb-1.5 text-[20px] font-bold tracking-[-0.01em] text-foreground">
                  No workout scheduled
                </h3>
                <p className="mb-5 max-w-[260px] text-sm leading-relaxed text-muted-foreground">
                  Start a blank session, or let FitBot build one for you.
                </p>
                <button
                  type="button"
                  onClick={() => { startEmptyWorkout(); router.push("/track"); }}
                  data-testid="button-start-workout"
                  className="flex h-[54px] w-full items-center justify-center gap-2 rounded-[15px] bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-base font-bold text-primary-foreground shadow-cta-strong"
                >
                  <Play className="h-[19px] w-[19px] fill-current" />
                  Start Workout
                </button>
                <div className="my-3.5 flex w-full items-center gap-2">
                  <div className="h-px flex-1 bg-divider" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-tertiary-foreground">
                    Or
                  </span>
                  <div className="h-px flex-1 bg-divider" />
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/fit-bot/workout")}
                  data-testid="button-fitbot-entry"
                  className="flex h-[52px] w-full items-center gap-2.5 rounded-[14px] border-[1.5px] border-yellow bg-primary-dim px-4 text-left"
                >
                  <Sparkles className="h-[18px] w-[18px] shrink-0 text-primary" />
                  <span className="flex-1 text-sm text-muted-foreground">Describe your workout…</span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-tertiary-foreground" />
                </button>
              </div>
            </div>

            {/* Start a program (→ /fit-bot program builder). */}
            <button
              type="button"
              onClick={() => router.push("/fit-bot")}
              data-testid="button-start-program"
              className="card-elevated flex w-full items-center gap-3.5 p-4 text-left"
            >
              <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-primary-dim text-primary">
                <ClipboardList className="h-[22px] w-[22px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-foreground">Start a program</div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  Follow a structured plan to hit your goals
                </div>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-tertiary-foreground" />
            </button>
          </div>
        )}

        {upcomingWorkouts.length > 0 && (
          <div className="space-y-3">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-tertiary-foreground">
              Upcoming
            </span>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {upcomingWorkouts.map((workout) => {
                const isCompleted = isWorkoutCompleted(workout.displayId);
                const isPastDue = !isCompleted && isBefore(startOfDay(workout.date), startOfDay(new Date()));
                const workoutImage = getWorkoutImageUrl(workout.exercises);
                return (
                  <ScheduledWorkoutCard
                    key={workout.displayId}
                    workout={workout}
                    imageUrl={workoutImage}
                    titleExtraClass="md:text-[1.75rem]"
                    onStart={handleStartWorkout}
                    onEdit={handleEditWorkout}
                    onEditTemplate={handleEditTemplate}
                    onSkip={handleSkipWorkout}
                    onDelete={handleDeleteWorkout}
                    badges={
                      <>
                        {isPastDue && (
                          <Badge variant="outline" className="text-red-500 border-red-500 bg-red-950/30">
                            Past Due
                          </Badge>
                        )}
                        {isCompleted && (
                          <Badge variant="outline" className="text-green-500 border-green-500">
                            <Check className="h-3 w-3 mr-1" />
                            Done
                          </Badge>
                        )}
                        {workout.routineInstanceId && (
                          <Badge variant="outline" className="text-primary border-primary/50">
                            {routineInstanceMap.get(workout.routineInstanceId) || "Routine"}
                          </Badge>
                        )}
                        {originalWorkoutIds.has(workout.id) && (
                          <Badge variant="outline" className="text-blue-400 border-blue-400/50" data-testid={`badge-original-${workout.displayId}`}>
                            Original
                          </Badge>
                        )}
                      </>
                    }
                  />
                );
              })}
            </div>
          </div>
        )}

        {completedWorkouts.length > 0 && (
          <div className="space-y-3">
            <span
              className="font-mono text-[12px] uppercase tracking-[0.2em] text-tertiary-foreground"
              data-testid="text-recent-workouts-title"
            >
              Recent
            </span>
            <div className="card-elevated overflow-hidden">
              {completedWorkouts.slice(0, 6).map((workout, index, arr) => (
                <div
                  key={`${workout.displayId}-${index}`}
                  className={`flex items-center justify-between gap-3 px-4 py-4 ${
                    index < arr.length - 1 ? "border-b border-divider" : ""
                  }`}
                  data-testid={`card-recent-workout-${index}`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-primary-dim">
                      <Dumbbell className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold text-foreground">{workout.name}</p>
                      <p className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.04em] text-tertiary-foreground">
                        {format(workout.completedAt, "MMM d")} · {workout.exercises.length} exercise{workout.exercises.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleRestartWorkout(workout)}
                      aria-label={`Repeat ${workout.name}`}
                      data-testid={`button-restart-workout-${index}`}
                      className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-dim text-primary"
                    >
                      <Play className="h-4 w-4 fill-current" />
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Options for ${workout.name}`}
                          data-testid={`button-recent-workout-menu-${index}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleScheduleAgain(workout)}
                          data-testid={`button-schedule-again-${index}`}
                        >
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          Schedule Again
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleEditCompletedWorkout(workout)}
                          data-testid={`button-edit-recent-workout-${index}`}
                        >
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteCompletedWorkout(workout.id, workout.name)}
                          className="text-destructive"
                          data-testid={`button-delete-recent-workout-${index}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span
              className="font-mono text-[12px] uppercase tracking-[0.2em] text-tertiary-foreground"
              data-testid="text-all-workouts-title"
            >
              Library
            </span>
          </div>
          {workoutTemplates.length > 0 ? (
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
              {workoutTemplates.map((template) => {
                const templateImage = getWorkoutImageUrl(template.exercises);
                return (
                  <div key={template.id} className="aspect-square" data-testid={`card-library-workout-${template.id}`}>
                    <div className={`relative flex h-full flex-col overflow-hidden rounded-[18px] ${templateImage ? "bg-card" : "card-elevated"}`}>
                      {templateImage && (
                        <>
                          <img src={templateImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
                        </>
                      )}
                      <div className="relative z-10 flex items-start justify-between p-4">
                        {templateImage ? (
                          <div />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-primary-dim">
                            <Dumbbell className="h-[22px] w-[22px] text-primary" />
                          </div>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={templateImage ? "text-white" : ""}
                              aria-label={`Options for ${template.name}`}
                              data-testid={`button-library-workout-menu-${template.id}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleEditTemplate(template.id)}
                              data-testid={`button-edit-library-workout-${template.id}`}
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteTemplate(template.id, template.name)}
                              className="text-destructive"
                              data-testid={`button-delete-library-workout-${template.id}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="flex-1" />
                      <div className="relative z-10 flex items-end justify-between gap-2 p-4 pt-0">
                        <div className="min-w-0">
                          <div className={`truncate text-[17px] font-semibold ${templateImage ? "text-white" : "text-foreground"}`}>
                            {template.name}
                          </div>
                          <div className={`mt-0.5 font-mono text-[11px] uppercase tracking-[0.04em] ${templateImage ? "text-white/60" : "text-tertiary-foreground"}`}>
                            {template.exercises.length} exercise{template.exercises.length === 1 ? "" : "s"}
                          </div>
                          {getTemplateCompletionCount(template.id) > 0 && (
                            <div className={`mt-0.5 text-[11px] ${templateImage ? "text-white/50" : "text-muted-foreground"}`}>
                              Completed {getTemplateCompletionCount(template.id)} time{getTemplateCompletionCount(template.id) !== 1 ? "s" : ""}
                            </div>
                          )}
                          {templateRoutineUsage[template.id] && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-primary/80">
                              <Link2 className="h-3 w-3" />
                              <span className="truncate">{templateRoutineUsage[template.id].join(", ")}</span>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleStartFromTemplate(template.id)}
                          aria-label={`Start ${template.name}`}
                          data-testid={`button-start-library-workout-${template.id}`}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-dim text-primary"
                        >
                          <Play className="h-4 w-4 fill-current" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="card-elevated p-6 text-center text-muted-foreground">
              <p>No workouts created yet</p>
              <p className="mt-1 text-sm">Tap + above to create your first workout</p>
            </div>
          )}
        </div>

        <WorkoutEditorDialog
          isOpen={showEditorDialog}
          onClose={() => {
            setShowEditorDialog(false);
            setEditingWorkout(null);
            setEditingTemplateId(null);
            setEditingCompletedWorkout(null);
          }}
          onSave={handleSaveWorkout}
          initialData={editingWorkout ? { ...editingWorkout, repeatType: "none" as const } : null}
          availableExercises={allAvailableExercises}
        />

        <AlertDialog open={!!workoutToDelete} onOpenChange={(open) => !open && setWorkoutToDelete(null)}>
          <AlertDialogContent data-testid="dialog-confirm-delete">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Workout</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{workoutToDelete?.name}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteWorkout}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive border-destructive"
                data-testid="button-confirm-delete"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={!!scheduleAgainWorkout} onOpenChange={(open) => { if (!open) { setScheduleAgainWorkout(null); setScheduleAgainDate(addDays(new Date(), 1)); } }}>
          <DialogContent data-testid="dialog-schedule-again">
            <DialogHeader>
              <DialogTitle>Schedule Again</DialogTitle>
              <DialogDescription>
                Pick a date to schedule "{scheduleAgainWorkout?.name}"
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Calendar
                mode="single"
                selected={scheduleAgainDate}
                onSelect={(date) => date && setScheduleAgainDate(date)}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                className="rounded-md border mx-auto"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setScheduleAgainWorkout(null)} data-testid="button-cancel-schedule-again">
                Cancel
              </Button>
              <Button onClick={confirmScheduleAgain} data-testid="button-confirm-schedule-again">
                Schedule for {format(scheduleAgainDate, "MMM d")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!updateFutureTemplateId} onOpenChange={(open) => !open && setUpdateFutureTemplateId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Update Future Scheduled Workouts?</AlertDialogTitle>
              <AlertDialogDescription>
                You have future scheduled workouts based on this workout. Would you like to update them with the new exercises?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-skip-update-future">No, keep them as is</AlertDialogCancel>
              <AlertDialogAction onClick={confirmUpdateFutureScheduled} disabled={isUpdatingFuture} data-testid="button-confirm-update-future">
                {isUpdatingFuture ? "Updating..." : "Yes, update future workouts"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}