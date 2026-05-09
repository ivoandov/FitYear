"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ExerciseCard } from "@/components/ExerciseCard";
import { AddExerciseDialog, type ExerciseFormData } from "@/components/AddExerciseDialog";
import { AddToWorkoutDialog } from "@/components/AddToWorkoutDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus } from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { type Exercise } from "@/data/exercises";
import { useSettings } from "@/components/SettingsProvider";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DBExercise {
  id: string;
  userId: string | null;
  isPublic: boolean;
  name: string;
  muscleGroups: string[];
  description: string;
  imageUrl: string | null;
  exerciseType: string | null;
  isAssisted: boolean | null;
}

export default function ExercisesPage() {
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingExercise, setEditingExercise] = useState<ExerciseFormData | null>(null);
  const [exerciseToAddToWorkout, setExerciseToAddToWorkout] = useState<Exercise | null>(null);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { muscleGroups: userMuscleGroups } = useSettings();
  const muscleGroups = ["All", ...userMuscleGroups];

  const { data: dbExercises = [], isLoading, isError, error } = useQuery<DBExercise[]>({
    queryKey: ["/api/exercises"],
  });

  const allExercises = useMemo<Exercise[]>(
    () =>
      dbExercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        muscleGroups: ex.muscleGroups,
        description: ex.description,
        imageUrl: ex.imageUrl || undefined,
        exerciseType: (ex.exerciseType as "weight_reps" | "distance_time") || "weight_reps",
        isAssisted: ex.isAssisted || false,
      })),
    [dbExercises],
  );

  const createMutation = useMutation({
    mutationFn: async (exercise: { name: string; muscleGroups: string[]; description: string; exerciseType: string; isAssisted: boolean }) => {
      return apiRequest("POST", "/api/exercises", exercise);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      setShowAddDialog(false);
      toast({
        title: "Exercise Created",
        description: "Your custom exercise has been added. An AI image is being generated.",
      });
      // Refresh again after a delay to pick up the generated image
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      }, 8000);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create exercise. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (exercise: ExerciseFormData & { id: string }) => {
      return apiRequest("PUT", `/api/exercises/${exercise.id}`, {
        name: exercise.name,
        muscleGroups: exercise.muscleGroups,
        description: exercise.description,
        exerciseType: exercise.exerciseType,
        isAssisted: exercise.isAssisted,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      // Also invalidate completed workouts so stats update with new muscle groups
      queryClient.invalidateQueries({ queryKey: ["/api/completed-workouts"] });
      setEditingExercise(null);
      toast({
        title: "Exercise Updated",
        description: "Your exercise has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update exercise. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/exercises/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({
        title: "Exercise Deleted",
        description: "The exercise has been removed from your library.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete exercise. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleRegenerateImage = useCallback(async (id: string) => {
    const exercise = allExercises.find(ex => ex.id === id);
    if (!exercise) return;

    setRegeneratingIds(prev => new Set(prev).add(id));
    try {
      await apiRequest("POST", `/api/exercises/${id}/regenerate-image`, {
        name: exercise.name,
        muscleGroups: exercise.muscleGroups,
        description: exercise.description,
        exerciseType: exercise.exerciseType,
      });
      toast({
        title: "Regenerating Image",
        description: "A new AI image is being generated. It will appear in a few seconds.",
      });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
        setRegeneratingIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      }, 10000);
    } catch {
      toast({
        title: "Error",
        description: "Failed to regenerate image. Please try again.",
        variant: "destructive",
      });
      setRegeneratingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  }, [allExercises, toast]);

  const filteredExercises = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return allExercises.filter((exercise) => {
      const matchesMuscleGroup = selectedMuscleGroup === "All" || exercise.muscleGroups.includes(selectedMuscleGroup);
      const matchesSearch = exercise.name.toLowerCase().includes(q) ||
                            exercise.muscleGroups.some(g => g.toLowerCase().includes(q));
      return matchesMuscleGroup && matchesSearch;
    });
  }, [allExercises, selectedMuscleGroup, searchQuery]);

  const handleAddExercise = useCallback((id: string) => {
    const exercise = allExercises.find(ex => ex.id === id);
    if (exercise) setExerciseToAddToWorkout(exercise);
  }, [allExercises]);

  const handleDeleteExercise = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const handleEditExercise = useCallback((id: string) => {
    const exercise = allExercises.find(ex => ex.id === id);
    if (exercise) {
      setEditingExercise({
        id: exercise.id,
        name: exercise.name,
        muscleGroups: exercise.muscleGroups,
        description: exercise.description,
        exerciseType: (exercise.exerciseType as "weight_reps" | "distance_time" | null) || "weight_reps",
        isAssisted: exercise.isAssisted || false,
      });
    }
  }, [allExercises]);

  const handleSaveExercise = useCallback((data: ExerciseFormData) => {
    if (data.id) {
      updateMutation.mutate(data as ExerciseFormData & { id: string });
    } else {
      createMutation.mutate(data);
    }
  }, [createMutation, updateMutation]);

  return (
    <div className="flex-1 overflow-auto h-full">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-8 sm:pb-12 space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">
              Exercise Library
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Browse and add exercises to your workouts
            </p>
          </div>
          <Button onClick={() => setShowAddDialog(true)} data-testid="button-add-exercise">
            <Plus className="h-4 w-4 mr-2" />
            Add Exercise
          </Button>
        </div>

        <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search exercises..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          <ScrollArea className="w-full sm:w-auto whitespace-nowrap">
            <div className="flex gap-2 pb-2 sm:pb-0">
              {muscleGroups.map((group) => (
                <Badge
                  key={group}
                  variant={selectedMuscleGroup === group ? "default" : "outline"}
                  className="cursor-pointer whitespace-nowrap hover-elevate active-elevate-2 text-xs sm:text-sm"
                  onClick={() => setSelectedMuscleGroup(group)}
                  data-testid={`badge-muscle-group-${group.toLowerCase()}`}
                >
                  {group}
                </Badge>
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="sm:hidden" />
          </ScrollArea>
        </div>

        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filteredExercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              {...exercise}
              isEditable={true}
              isRegenerating={regeneratingIds.has(exercise.id)}
              onAdd={handleAddExercise}
              onEdit={handleEditExercise}
              onDelete={handleDeleteExercise}
              onRegenerateImage={handleRegenerateImage}
            />
          ))}
        </div>

        {isLoading && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading exercises...</p>
          </div>
        )}

        {isError && (
          <div className="text-center py-12">
            <p className="text-destructive">Error loading exercises: {error?.message}</p>
          </div>
        )}

        {!isLoading && !isError && filteredExercises.length === 0 && (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No exercises found ({dbExercises.length} total in database)</p>
          </div>
        )}

        <AddExerciseDialog
          isOpen={showAddDialog}
          onClose={() => setShowAddDialog(false)}
          onSave={handleSaveExercise}
          isPending={createMutation.isPending}
          mode="add"
        />

        <AddExerciseDialog
          isOpen={!!editingExercise}
          onClose={() => setEditingExercise(null)}
          onSave={handleSaveExercise}
          isPending={updateMutation.isPending}
          initialData={editingExercise}
          mode="edit"
        />

        <AddToWorkoutDialog
          isOpen={!!exerciseToAddToWorkout}
          onClose={() => setExerciseToAddToWorkout(null)}
          exercise={exerciseToAddToWorkout}
        />
      </div>
    </div>
  );
}