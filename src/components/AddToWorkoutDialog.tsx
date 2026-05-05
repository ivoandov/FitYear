"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar, Dumbbell } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { type Exercise } from "@/data/exercises";

interface ScheduledWorkout {
  id: string;
  name: string;
  date: string;
  exercises: Exercise[];
}

interface AddToWorkoutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  exercise: Exercise | null;
}

export function AddToWorkoutDialog({
  isOpen,
  onClose,
  exercise,
}: AddToWorkoutDialogProps) {
  const [selectedWorkouts, setSelectedWorkouts] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: workouts = [], isLoading } = useQuery<ScheduledWorkout[]>({
    queryKey: ["/api/scheduled-workouts"],
    enabled: isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedWorkouts(new Set());
    }
  }, [isOpen]);

  const updateWorkoutMutation = useMutation({
    mutationFn: async ({ workoutId, exercises }: { workoutId: string; exercises: Exercise[] }) => {
      const workout = workouts.find(w => w.id === workoutId);
      if (!workout) throw new Error("Workout not found");
      
      return apiRequest("PUT", `/api/scheduled-workouts/${workoutId}`, {
        name: workout.name,
        date: workout.date,
        exercises: exercises,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
    },
  });

  const handleToggleWorkout = (workoutId: string) => {
    const newSelected = new Set(selectedWorkouts);
    if (newSelected.has(workoutId)) {
      newSelected.delete(workoutId);
    } else {
      newSelected.add(workoutId);
    }
    setSelectedWorkouts(newSelected);
  };

  const handleAddToWorkouts = async () => {
    if (!exercise || selectedWorkouts.size === 0) return;

    const promises = Array.from(selectedWorkouts).map(workoutId => {
      const workout = workouts.find(w => w.id === workoutId);
      if (!workout) return Promise.resolve();
      
      const existingExerciseIds = new Set(workout.exercises.map(e => e.id));
      if (existingExerciseIds.has(exercise.id)) {
        return Promise.resolve();
      }
      
      const updatedExercises = [...workout.exercises, exercise];
      return updateWorkoutMutation.mutateAsync({ workoutId, exercises: updatedExercises });
    });

    try {
      await Promise.all(promises);
      toast({
        title: "Exercise Added",
        description: `${exercise.name} has been added to ${selectedWorkouts.size} workout${selectedWorkouts.size > 1 ? 's' : ''}.`,
      });
      onClose();
    } catch {
      toast({
        title: "Error",
        description: "Failed to add exercise to some workouts. Please try again.",
        variant: "destructive",
      });
    }
  };

  const isExerciseInWorkout = (workout: ScheduledWorkout): boolean => {
    if (!exercise) return false;
    return workout.exercises.some(e => e.id === exercise.id);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-add-to-workout">
        <DialogHeader>
          <DialogTitle>Add to Workout</DialogTitle>
          <DialogDescription>
            {exercise ? (
              <>Select which workouts to add <strong>{exercise.name}</strong> to.</>
            ) : (
              "Select workouts"
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center py-8">
            <Dumbbell className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              No scheduled workouts found.
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              Create a workout first from the Workouts page.
            </p>
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2 pr-4">
              {workouts.map((workout) => {
                const alreadyHasExercise = isExerciseInWorkout(workout);
                const isSelected = selectedWorkouts.has(workout.id);
                
                return (
                  <div
                    key={workout.id}
                    className={`flex items-center gap-3 p-3 rounded-md border ${
                      alreadyHasExercise 
                        ? 'opacity-50 cursor-not-allowed' 
                        : 'hover-elevate cursor-pointer'
                    }`}
                    onClick={() => !alreadyHasExercise && handleToggleWorkout(workout.id)}
                    data-testid={`workout-option-${workout.id}`}
                  >
                    <Checkbox
                      checked={isSelected || alreadyHasExercise}
                      disabled={alreadyHasExercise}
                      onCheckedChange={() => !alreadyHasExercise && handleToggleWorkout(workout.id)}
                      data-testid={`checkbox-workout-${workout.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{workout.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <Calendar className="h-3 w-3" />
                        <span>{format(new Date(workout.date), "MMM d, yyyy")}</span>
                        <span>•</span>
                        <span>{workout.exercises.length} exercise{workout.exercises.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    {alreadyHasExercise && (
                      <Badge variant="secondary" className="text-xs">
                        Added
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-add-to-workout">
            Cancel
          </Button>
          <Button
            onClick={handleAddToWorkouts}
            disabled={selectedWorkouts.size === 0 || updateWorkoutMutation.isPending}
            data-testid="button-confirm-add-to-workout"
          >
            {updateWorkoutMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              `Add to ${selectedWorkouts.size || 0} Workout${selectedWorkouts.size !== 1 ? 's' : ''}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}