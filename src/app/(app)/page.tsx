"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWorkoutMutations } from "@/hooks/use-workout-mutations";
import { WorkoutEditorDialog, type WorkoutData } from "@/components/WorkoutEditorDialog";
import { Button } from "@/components/ui/button";
import { Plus, Calendar as CalendarIcon, Pencil, Trash2, Play, Check, Clock, Dumbbell, SkipForward, FileEdit, Link2 } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, addDays, isBefore, startOfDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { MoreVertical } from "lucide-react";
import { type Exercise } from "@/data/exercises";
import { useWorkout } from "@/context/WorkoutContext";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { localDateKey } from "@/lib/date";
import { setWorkoutPreview } from "@/lib/workout-preview";
import { GoalsStrip } from "@/components/GoalsStrip";

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

  const allAvailableExercises: Exercise[] = dbExercises.map((ex) => ({
    id: ex.id,
    name: ex.name,
    muscleGroups: ex.muscleGroups,
    description: ex.description,
    imageUrl: ex.imageUrl || undefined,
    exerciseType: (ex.exerciseType as "weight_reps" | "distance_time") || "weight_reps",
  }));

  const scheduledWorkouts: ScheduledWorkout[] = dbWorkouts.map((w) => {
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
  });

  const workoutTemplates: WorkoutTemplate[] = dbTemplates.map((t) => ({
    id: t.id,
    name: t.name,
    exercises: (t.exercises as any[]).map((ex: any) => ({
      ...ex,
      muscleGroups: ex.muscleGroups || [],
    })) as Exercise[],
  }));

  const originalWorkoutIds = new Set<string>();
  {
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
        originalWorkoutIds.add(workouts[0].id);
      }
    });
  }

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
          
          // Calculate dates for recurring workouts
          const intervalDays = data.repeatType === "daily" ? 1 
            : data.repeatType === "weekly" ? 7 
            : (data.repeatInterval || 1);
          
          // Schedule next 4 occurrences starting from the selected date
          const numOccurrences = data.repeatType === "daily" ? 7 : 4;
          
          for (let i = 0; i < numOccurrences; i++) {
            const workoutDate = addDays(data.date, intervalDays * i);
            const localDate = localDateKey(workoutDate);
            await apiRequest("POST", "/api/scheduled-workouts", {
              name: data.name,
              date: workoutDate.toISOString(),
              localDate,
              exercises: data.exercises,
              templateId: template.id,
            });
          }
          
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
        
        // Calculate dates for recurring workouts
        if (data.repeatType && data.repeatType !== "none") {
          const intervalDays = data.repeatType === "daily" ? 1 
            : data.repeatType === "weekly" ? 7 
            : (data.repeatInterval || 1);
          
          const numOccurrences = data.repeatType === "daily" ? 7 : 4;
          
          for (let i = 0; i < numOccurrences; i++) {
            const workoutDate = addDays(data.date, intervalDays * i);
            const localDate = localDateKey(workoutDate);
            await apiRequest("POST", "/api/scheduled-workouts", {
              name: data.name,
              date: workoutDate.toISOString(),
              localDate,
              exercises: data.exercises,
              templateId: template.id,
            });
          }
          
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

  const getDisplayedWorkouts = () => {
    const workouts: (ScheduledWorkout & { displayId: string })[] = [];

    scheduledWorkouts.forEach((workout) => {
      workouts.push({
        ...workout,
        displayId: workout.id,
      });
    });

    return workouts.sort((a, b) => a.date.getTime() - b.date.getTime());
  };

  const displayedWorkouts = getDisplayedWorkouts();
  const todayWorkouts = displayedWorkouts.filter(
    (w) => format(w.date, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd")
  );
  const upcomingWorkouts = displayedWorkouts.filter(
    (w) => format(w.date, "yyyy-MM-dd") !== format(new Date(), "yyyy-MM-dd")
  );

  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");
  const selectedDateWorkouts = displayedWorkouts.filter(
    (w) => format(w.date, "yyyy-MM-dd") === selectedDateStr
  );

  const getWorkoutImageUrl = (exercises: Exercise[]) => {
    for (const ex of exercises) {
      const sourceExercise = allAvailableExercises.find(e => e.id === ex.id);
      if (sourceExercise?.imageUrl) return sourceExercise.imageUrl;
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
      <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-8 sm:pb-12 space-y-4 sm:space-y-6">
        {/* Instant start: open the app and just work out. No name, no
            pre-planned exercises — add them as you go on the Track screen. */}
        <Button
          onClick={() => { startEmptyWorkout(); router.push("/track"); }}
          className="w-full h-14 text-base font-bold shadow-cta"
          data-testid="button-start-workout"
        >
          <Play className="h-5 w-5 mr-2" />
          Start Workout
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">
              Scheduled Workouts
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Plan and manage your training schedule
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-calendar">
                  <CalendarIcon className="h-4 w-4" />
                </Button>
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
            <Button onClick={handleNewWorkout} size="icon" className="sm:w-auto sm:px-4" data-testid="button-new-workout">
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Workout</span>
            </Button>
          </div>
        </div>

        <GoalsStrip />

        {todayWorkouts.length > 0 && (
          <div className="space-y-3 sm:space-y-4">
            <h2 className="text-lg sm:text-xl font-semibold">Today</h2>
            {(() => {
              const firstUncompletedIndex = todayWorkouts.findIndex(w => !isWorkoutCompleted(w.displayId));
              const heroIndex = firstUncompletedIndex >= 0 ? firstUncompletedIndex : 0;
              const heroWorkout = todayWorkouts[heroIndex];
              const remainingWorkouts = todayWorkouts.filter((_, i) => i !== heroIndex);
              const heroImage = getWorkoutImageUrl(heroWorkout.exercises);
              const heroCompleted = isWorkoutCompleted(heroWorkout.displayId);
              const heroPastDue = !heroCompleted && isBefore(startOfDay(heroWorkout.date), startOfDay(new Date()));

              return (
                <>
                  <Card
                    className="border-0 relative overflow-hidden"
                    style={{ minHeight: '320px' }}
                    data-testid={`card-workout-${heroWorkout.displayId}`}
                  >
                    {heroImage && (
                      <>
                        <img src={heroImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />
                      </>
                    )}
                    {!heroImage && (
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/70 to-black/50" />
                    )}
                    <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-white"
                            data-testid={`button-workout-menu-${heroWorkout.displayId}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleEditWorkout(heroWorkout.displayId)}
                            data-testid={`button-edit-workout-${heroWorkout.displayId}`}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit This Instance
                          </DropdownMenuItem>
                          {heroWorkout.templateId && (
                            <DropdownMenuItem
                              onClick={() => handleEditTemplate(heroWorkout.templateId!)}
                              data-testid={`button-edit-source-${heroWorkout.displayId}`}
                            >
                              <FileEdit className="h-4 w-4 mr-2" />
                              Edit Source Workout
                            </DropdownMenuItem>
                          )}
                          {heroWorkout.routineInstanceId && (
                            <DropdownMenuItem
                              onClick={() => handleSkipWorkout(heroWorkout.id)}
                              data-testid={`button-skip-workout-${heroWorkout.displayId}`}
                            >
                              <SkipForward className="h-4 w-4 mr-2" />
                              Skip
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => handleDeleteWorkout(heroWorkout.displayId, heroWorkout.name)}
                            className="text-destructive"
                            data-testid={`button-delete-workout-${heroWorkout.displayId}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="relative z-10 flex flex-col items-center justify-center text-center px-6 py-8" style={{ minHeight: '320px' }}>
                      {(() => {
                        const ai = activeRoutineForHero(heroWorkout, activeRoutineInstances);
                        if (!ai) return null;
                        return (
                          <>
                            <p className="text-xs uppercase tracking-wide text-white/70 mb-2">
                              Day {ai.dayNumber} of {ai.totalDays} · {ai.routineName}
                            </p>
                          </>
                        );
                      })()}
                      <h3 className="text-2xl sm:text-3xl font-bold text-white mb-1">
                        {heroWorkout.name}
                      </h3>
                      <p className="text-sm text-white/60 mb-2">
                        {heroWorkout.exercises.length} exercises
                      </p>
                      {(() => {
                        const ai = activeRoutineForHero(heroWorkout, activeRoutineInstances);
                        if (!ai) return null;
                        const pct = Math.min(100, Math.round((ai.completedSoFar / ai.totalDays) * 100));
                        return (
                          <div className="w-full max-w-xs mb-4">
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                              <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })()}
                      <Button
                        className="w-full max-w-xs"
                        onClick={() => handleStartWorkout(heroWorkout.displayId)}
                        data-testid={`button-start-workout-${heroWorkout.displayId}`}
                      >
                        Start
                      </Button>
                    </div>
                  </Card>

                  {remainingWorkouts.length > 0 && (
                    <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
                      {remainingWorkouts.map((workout) => {
                        const isCompleted = isWorkoutCompleted(workout.displayId);
                        const workoutImage = getWorkoutImageUrl(workout.exercises);
                        return (
                          <div key={workout.displayId} className="aspect-square" data-testid={`card-workout-${workout.displayId}`}>
                            <Card className="border-0 h-full flex flex-col relative overflow-hidden">
                              {workoutImage && (
                                <>
                                  <img src={workoutImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />
                                </>
                              )}
                              <div className="relative flex items-start justify-between p-4 sm:p-5 z-10">
                                <CardTitle className={`text-lg sm:text-xl font-semibold flex-1 break-words line-clamp-2 ${workoutImage ? 'text-white' : ''}`}>
                                  {workout.name}
                                </CardTitle>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className={workoutImage ? 'text-white' : ''}
                                      data-testid={`button-workout-menu-${workout.displayId}`}
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => handleEditWorkout(workout.displayId)}
                                      data-testid={`button-edit-workout-${workout.displayId}`}
                                    >
                                      <Pencil className="h-4 w-4 mr-2" />
                                      Edit This Instance
                                    </DropdownMenuItem>
                                    {workout.templateId && (
                                      <DropdownMenuItem
                                        onClick={() => handleEditTemplate(workout.templateId!)}
                                        data-testid={`button-edit-source-${workout.displayId}`}
                                      >
                                        <FileEdit className="h-4 w-4 mr-2" />
                                        Edit Source Workout
                                      </DropdownMenuItem>
                                    )}
                                    {workout.routineInstanceId && (
                                      <DropdownMenuItem
                                        onClick={() => handleSkipWorkout(workout.id)}
                                        data-testid={`button-skip-workout-${workout.displayId}`}
                                      >
                                        <SkipForward className="h-4 w-4 mr-2" />
                                        Skip
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteWorkout(workout.displayId, workout.name)}
                                      className="text-destructive"
                                      data-testid={`button-delete-workout-${workout.displayId}`}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              {!workoutImage && (
                                <div className="px-4 sm:px-5 flex-1 flex items-center justify-center">
                                  <Dumbbell className="h-12 w-12 sm:h-14 sm:w-14 text-primary opacity-60" />
                                </div>
                              )}
                              {workoutImage && <div className="flex-1" />}
                              <div className="relative px-4 sm:px-5 pb-4 sm:pb-5 flex items-center justify-between gap-2 z-10">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className={`text-sm sm:text-base ${workoutImage ? 'text-white/70' : 'text-muted-foreground'}`}>
                                    {format(workout.date, "MMM d, yyyy")}
                                  </p>
                                  {isCompleted && (
                                    <Badge variant="outline" className="text-green-500 border-green-500">
                                      <Check className="h-3 w-3 mr-1" />
                                      Done
                                    </Badge>
                                  )}
                                </div>
                                <Button
                                  size="icon"
                                  className="shrink-0 aspect-square"
                                  onClick={() => handleStartWorkout(workout.displayId)}
                                  data-testid={`button-start-workout-${workout.displayId}`}
                                >
                                  <Play className="h-4 w-4" />
                                </Button>
                              </div>
                            </Card>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {upcomingWorkouts.length > 0 && (
          <div className="space-y-3 sm:space-y-4">
            <h2 className="text-lg sm:text-xl font-semibold">Upcoming</h2>
            <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
              {upcomingWorkouts.map((workout) => {
                const isCompleted = isWorkoutCompleted(workout.displayId);
                const isPastDue = !isCompleted && isBefore(startOfDay(workout.date), startOfDay(new Date()));
                const workoutImage = getWorkoutImageUrl(workout.exercises);
                return (
                  <div key={workout.displayId} className="aspect-square" data-testid={`card-workout-${workout.displayId}`}>
                    <Card className="border-0 h-full flex flex-col relative overflow-hidden">
                      {workoutImage && (
                        <>
                          <img src={workoutImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />
                        </>
                      )}
                      <div className="relative flex items-start justify-between p-4 sm:p-5 z-10">
                        <CardTitle className={`text-lg sm:text-xl md:text-[1.75rem] font-semibold flex-1 break-words line-clamp-2 ${workoutImage ? 'text-white' : ''}`}>
                          {workout.name}
                        </CardTitle>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={workoutImage ? 'text-white' : ''}
                              data-testid={`button-workout-menu-${workout.displayId}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleEditWorkout(workout.displayId)}
                              data-testid={`button-edit-workout-${workout.displayId}`}
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit This Instance
                            </DropdownMenuItem>
                            {workout.templateId && (
                              <DropdownMenuItem
                                onClick={() => handleEditTemplate(workout.templateId!)}
                                data-testid={`button-edit-source-${workout.displayId}`}
                              >
                                <FileEdit className="h-4 w-4 mr-2" />
                                Edit Source Workout
                              </DropdownMenuItem>
                            )}
                            {workout.routineInstanceId && (
                              <DropdownMenuItem
                                onClick={() => handleSkipWorkout(workout.id)}
                                data-testid={`button-skip-workout-${workout.displayId}`}
                              >
                                <SkipForward className="h-4 w-4 mr-2" />
                                Skip
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => handleDeleteWorkout(workout.displayId, workout.name)}
                              className="text-destructive"
                              data-testid={`button-delete-workout-${workout.displayId}`}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {!workoutImage && (
                        <div className="px-4 sm:px-5 flex-1 flex items-center justify-center">
                          <Dumbbell className="h-12 w-12 sm:h-14 sm:w-14 text-primary opacity-60" />
                        </div>
                      )}
                      {workoutImage && <div className="flex-1" />}
                      <div className="relative px-4 sm:px-5 pb-4 sm:pb-5 flex items-center justify-between gap-2 z-10">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-sm sm:text-base ${workoutImage ? 'text-white/70' : 'text-muted-foreground'}`}>
                            {format(workout.date, "MMM d, yyyy")}
                          </p>
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
                        </div>
                        <Button
                          size="icon"
                          className="shrink-0 aspect-square"
                          onClick={() => handleStartWorkout(workout.displayId)}
                          data-testid={`button-start-workout-${workout.displayId}`}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {displayedWorkouts.length === 0 && (
          <Card className="p-8 sm:p-12 text-center">
            <div className="text-muted-foreground">
              <CalendarIcon className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-base sm:text-lg font-semibold mb-4">No workouts scheduled</h3>
              <Button onClick={handleNewWorkout} data-testid="button-create-first-workout">
                <Plus className="h-4 w-4 mr-2" />
                Create Workout
              </Button>
            </div>
          </Card>
        )}

        {completedWorkouts.length > 0 && (
          <div className="space-y-3 sm:space-y-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-recent-workouts-title">
                Recent Workouts
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Your completed sessions
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:gap-4">
              {completedWorkouts.slice(0, 6).map((workout, index) => (
                <Card 
                  key={`${workout.displayId}-${index}`}
                  className="hover-elevate border-0"
                  data-testid={`card-recent-workout-${index}`}
                >
                  <div className="flex items-center justify-between p-4 sm:p-5 gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <Dumbbell className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-base truncate">{workout.name}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-muted-foreground">{format(workout.completedAt, "PP")}</span>
                          <Badge variant="outline" className="text-green-500 border-green-500 no-default-hover-elevate no-default-active-elevate">
                            <Check className="h-3 w-3 mr-1" />
                            Done
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon"
                        onClick={() => handleRestartWorkout(workout)}
                        data-testid={`button-restart-workout-${index}`}
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
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
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 sm:space-y-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold" data-testid="text-all-workouts-title">
              All Workouts
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Your workout library
            </p>
          </div>
          {workoutTemplates.length > 0 ? (
            <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
              {workoutTemplates.map((template) => {
                const templateImage = getWorkoutImageUrl(template.exercises);
                return (
                <div key={template.id} className="aspect-square" data-testid={`card-library-workout-${template.id}`}>
                <Card 
                  className="border-0 h-full flex flex-col relative overflow-hidden"
                >
                  {templateImage && (
                    <>
                      <img src={templateImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />
                    </>
                  )}
                  <div className="relative flex items-start justify-between p-4 sm:p-5 z-10">
                    <CardTitle className={`text-lg sm:text-xl md:text-[1.75rem] font-semibold flex-1 break-words line-clamp-2 ${templateImage ? 'text-white' : ''}`}>
                      {template.name}
                    </CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={templateImage ? 'text-white' : ''}
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
                  {!templateImage && (
                    <div className="px-4 sm:px-5 flex-1 flex items-center justify-center">
                      <Dumbbell className="h-12 w-12 sm:h-14 sm:w-14 text-primary opacity-60" />
                    </div>
                  )}
                  {templateImage && <div className="flex-1" />}
                  <div className={`relative px-4 sm:px-5 pb-4 sm:pb-5 flex items-center justify-between gap-2 z-10`}>
                    <div className="flex flex-col gap-0.5">
                      <p className={`text-sm sm:text-base ${templateImage ? 'text-white/70' : 'text-muted-foreground'}`}>
                        {template.exercises.length} exercises
                      </p>
                      {getTemplateCompletionCount(template.id) > 0 && (
                        <p className={`text-xs ${templateImage ? 'text-white/50' : 'text-muted-foreground/70'}`}>
                          Completed {getTemplateCompletionCount(template.id)} time{getTemplateCompletionCount(template.id) !== 1 ? 's' : ''}
                        </p>
                      )}
                      {templateRoutineUsage[template.id] && (
                        <div className="flex items-center gap-1 text-xs text-primary/80">
                          <Link2 className="h-3 w-3" />
                          <span className="truncate">{templateRoutineUsage[template.id].join(", ")}</span>
                        </div>
                      )}
                    </div>
                    <Button
                      size="icon"
                      className="shrink-0 aspect-square"
                      onClick={() => handleStartFromTemplate(template.id)}
                      data-testid={`button-start-library-workout-${template.id}`}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
                </div>
                );
              })}
            </div>
          ) : (
            <Card className="p-6 sm:p-8 border-0">
              <div className="text-center text-muted-foreground">
                <p>No workouts created yet</p>
                <p className="text-sm mt-1">Click "New Workout" to create your first workout</p>
              </div>
            </Card>
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