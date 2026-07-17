"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ExerciseCard } from "@/components/ExerciseCard";
import { AddExerciseDialog, type ExerciseFormData } from "@/components/AddExerciseDialog";
import { AddToWorkoutDialog } from "@/components/AddToWorkoutDialog";
import { Input } from "@/components/ui/input";
import { Search, Plus } from "lucide-react";
import { type Exercise } from "@/data/exercises";
import { COARSE_MUSCLE_GROUPS, matchesCoarse, type CoarseGroup } from "@/lib/muscle-groups";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { DesktopTopBar } from "@/components/DesktopTopBar";
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

/**
 * Extract the duplicate-guard payload from a thrown apiRequest error. The
 * create API answers 409 + { error: "duplicate", match } when the name
 * confidently matches an existing exercise; anything else returns null.
 */
function duplicateMatchFrom(e: unknown): { id: string; name: string } | null {
  if (!(e instanceof Error)) return null;
  const m = e.message.match(/^409:\s*([\s\S]*)$/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (parsed?.error === "duplicate" && parsed.match?.id && parsed.match?.name) {
      return { id: parsed.match.id, name: parsed.match.name };
    }
  } catch {
    // not our payload
  }
  return null;
}

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
  // The create call hit the duplicate guard: hold the submitted form + the
  // server's match while the user picks "use existing" vs "create anyway".
  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    pending: { name: string; muscleGroups: string[]; description: string; exerciseType: string; isAssisted: boolean };
    match: { id: string; name: string };
  } | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const muscleGroups = ["All", ...COARSE_MUSCLE_GROUPS];

  const { data: dbExercises = [], isLoading, isError, error } = useQuery<DBExercise[]>({
    queryKey: ["/api/exercises"],
  });

  const allExercises = useMemo<Exercise[]>(
    () =>
      dbExercises.map((ex) => ({
        id: ex.id,
        // userId must flow through: the card's isOwner check below is
        // `exercise.userId === user.id`. Dropping it here made isOwner always
        // false, so owners lost Edit/Delete/Regenerate on their own exercises.
        userId: ex.userId,
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
    mutationFn: async (exercise: { name: string; muscleGroups: string[]; description: string; exerciseType: string; isAssisted: boolean; force?: boolean }) => {
      const res = await apiRequest("POST", "/api/exercises", exercise);
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      setShowAddDialog(false);
      toast({
        title: "Exercise Created",
        description: "Your custom exercise has been added. Generating an image…",
      });
      // Best-effort AI image (Imagen via Vertex). Non-blocking: the exercise
      // already exists, so if generation fails it simply stays imageless. The
      // card shows the regenerating spinner while it runs (~10-25s), then the
      // list refreshes to pick up the new image.
      if (created?.id) {
        const newId = created.id;
        setRegeneratingIds(prev => new Set(prev).add(newId));
        apiRequest("POST", `/api/exercises/${newId}/regenerate-image`, {})
          .catch(() => {
            // Generation failed (e.g. Vertex/billing). Exercise still created.
          })
          .finally(() => {
            setRegeneratingIds(prev => {
              const next = new Set(prev);
              next.delete(newId);
              return next;
            });
            queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
          });
      }
    },
    onError: (error, variables) => {
      const match = duplicateMatchFrom(error);
      if (match) {
        setDuplicatePrompt({ pending: variables, match });
        return;
      }
      toast({
        title: "Couldn't create exercise",
        description: describeApiError(error),
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
    onError: (error) => {
      toast({
        title: "Couldn't update exercise",
        description: describeApiError(error),
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
    onError: (error) => {
      toast({
        title: "Couldn't delete exercise",
        description: describeApiError(error),
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
    } catch (error) {
      toast({
        title: "Couldn't regenerate image",
        description: describeApiError(error),
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
      const matchesMuscleGroup = selectedMuscleGroup === "All" || matchesCoarse(exercise.muscleGroups, selectedMuscleGroup as CoarseGroup);
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
      <DesktopTopBar title="Exercises">
        <div className="relative w-[280px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search exercises…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 rounded-xl bg-input pl-10 text-sm"
            aria-label="Search exercises"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowAddDialog(true)}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Add
        </button>
      </DesktopTopBar>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 pb-8 sm:pb-12 space-y-4 sm:space-y-6 md:pt-7">
        <div className="flex items-center justify-between gap-3 md:hidden">
          <div>
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]" data-testid="text-page-title">
              Exercises
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse and add to workouts
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddDialog(true)}
            className="flex h-[42px] shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
            data-testid="button-add-exercise"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Add
          </button>
        </div>

        <div className="space-y-3">
          <div className="relative md:hidden">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search exercises…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-[46px] rounded-xl bg-input pl-11 text-[15px]"
              data-testid="input-search"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {muscleGroups.map((group) => {
              const active = selectedMuscleGroup === group;
              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => setSelectedMuscleGroup(group)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-[15px] py-[7px] text-[13px] transition-colors ${
                    active
                      ? "bg-primary font-bold text-primary-foreground"
                      : "border bg-white/[0.04] font-medium text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`badge-muscle-group-${group.toLowerCase()}`}
                >
                  {group}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filteredExercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              {...exercise}
              isOwner={!!user?.id && exercise.userId === user.id}
              isRegenerating={regeneratingIds.has(exercise.id)}
              onAdd={handleAddExercise}
              onEdit={handleEditExercise}
              onDelete={handleDeleteExercise}
              onRegenerateImage={handleRegenerateImage}
            />
          ))}
        </div>

        {isLoading && (
          <div className="py-12 text-center font-mono text-xs uppercase tracking-[0.14em] text-tertiary-foreground">
            Loading exercises…
          </div>
        )}

        {isError && (
          <div className="py-12 text-center text-sm text-destructive">
            Error loading exercises: {error?.message}
          </div>
        )}

        {!isLoading && !isError && filteredExercises.length === 0 && (
          <div className="py-12 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-tertiary-foreground">
              No exercises found
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{dbExercises.length} total in library</p>
          </div>
        )}

        <AddExerciseDialog
          isOpen={showAddDialog}
          onClose={() => setShowAddDialog(false)}
          onSave={handleSaveExercise}
          isPending={createMutation.isPending}
          mode="add"
          library={allExercises}
        />

        <AddExerciseDialog
          isOpen={!!editingExercise}
          onClose={() => setEditingExercise(null)}
          onSave={handleSaveExercise}
          isPending={updateMutation.isPending}
          initialData={editingExercise}
          mode="edit"
          library={allExercises}
        />

        <AlertDialog
          open={!!duplicatePrompt}
          onOpenChange={(open) => !open && setDuplicatePrompt(null)}
        >
          <AlertDialogContent data-testid="dialog-duplicate-exercise">
            <AlertDialogHeader>
              <AlertDialogTitle>This exercise may already exist</AlertDialogTitle>
              <AlertDialogDescription>
                &ldquo;{duplicatePrompt?.pending.name}&rdquo; looks like the
                library&apos;s &ldquo;{duplicatePrompt?.match.name}&rdquo;.
                Using the existing exercise keeps its history, PRs, and progress
                in one place.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                data-testid="button-use-existing"
                onClick={() => {
                  const existing = duplicatePrompt?.match;
                  setDuplicatePrompt(null);
                  setShowAddDialog(false);
                  if (existing) {
                    toast({
                      title: "Using the existing exercise",
                      description: `"${existing.name}" is already in the library.`,
                    });
                  }
                }}
              >
                Use existing
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="button-create-anyway"
                onClick={() => {
                  const pending = duplicatePrompt?.pending;
                  setDuplicatePrompt(null);
                  if (pending) createMutation.mutate({ ...pending, force: true });
                }}
              >
                Create anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AddToWorkoutDialog
          isOpen={!!exerciseToAddToWorkout}
          onClose={() => setExerciseToAddToWorkout(null)}
          exercise={exerciseToAddToWorkout}
        />
      </div>
    </div>
  );
}