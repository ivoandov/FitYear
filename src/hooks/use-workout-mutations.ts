"use client";

import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { localDateKey } from "@/lib/date";
import { useToast } from "@/hooks/use-toast";
import { type Exercise } from "@/data/exercises";

/**
 * All scheduled-workout + template + skip mutations for the home page, with
 * their toast + query-invalidation wiring. Extracted verbatim from the home
 * god component (behavior-identical). Completed-workout mutations live on
 * WorkoutContext (useWorkout).
 */
export function useWorkoutMutations() {
  const { toast } = useToast();

  const createTemplateMutation = useMutation({
    mutationFn: async (template: { name: string; exercises: Exercise[] }) => {
      return apiRequest("POST", "/api/workout-templates", {
        name: template.name,
        exercises: template.exercises,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
    },
    onError: (error) => {
      console.error("Failed to create workout template:", error);
      toast({
        title: "Couldn't create workout",
        description: describeApiError(error),
        variant: "destructive",
      });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, ...template }: { id: string; name: string; exercises: Exercise[] }) => {
      return apiRequest("PUT", `/api/workout-templates/${id}`, {
        name: template.name,
        exercises: template.exercises,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
    },
    onError: (error) => {
      console.error("Failed to update workout template:", error);
      toast({
        title: "Couldn't update workout",
        description: describeApiError(error),
        variant: "destructive",
      });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/workout-templates/${id}`);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
      toast({
        title: "Workout Deleted",
        description: "The workout has been removed from your library.",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "";
      try {
        const jsonStr = errorMessage.replace(/^\d+:\s*/, "");
        const data = JSON.parse(jsonStr);
        if (data?.error === "template_in_use") {
          const names = data.routineNames?.join(", ") || "some routines";
          toast({
            title: "Cannot Delete Workout",
            description: `This workout is used by: ${names}. Remove it from those routines first.`,
            variant: "destructive",
          });
          return;
        }
      } catch {}
      toast({
        title: "Error",
        description: "Failed to delete workout. Please try again.",
        variant: "destructive",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (workout: { name: string; date: Date; exercises: Exercise[]; templateId?: string }) => {
      // Send both UTC timestamp and local date string for correct calendar sync
      const localDate = localDateKey(workout.date);
      return apiRequest("POST", "/api/scheduled-workouts", {
        name: workout.name,
        date: workout.date.toISOString(),
        localDate,
        exercises: workout.exercises,
        templateId: workout.templateId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
    },
    onError: (error) => {
      console.error("Failed to create workout:", error);
      toast({
        title: "Couldn't schedule workout",
        description: describeApiError(error),
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...workout }: { id: string; name: string; date: Date; exercises: Exercise[] }) => {
      // Send both UTC timestamp and local date string for correct handling
      const localDate = localDateKey(workout.date);
      return apiRequest("PUT", `/api/scheduled-workouts/${id}`, {
        name: workout.name,
        date: workout.date.toISOString(),
        localDate,
        exercises: workout.exercises,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
    },
    onError: (error) => {
      console.error("Failed to update workout:", error);
      toast({
        title: "Couldn't update workout",
        description: describeApiError(error),
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/scheduled-workouts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
    },
  });

  const skipWorkoutMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/scheduled-workouts/${id}/skip`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routine-instances/active"] });
      toast({
        title: "Workout Skipped",
        description: "This workout has been marked as skipped.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to skip workout",
        description: describeApiError(error),
        variant: "destructive",
      });
    },
  });

  return {
    createTemplateMutation,
    updateTemplateMutation,
    deleteTemplateMutation,
    createMutation,
    updateMutation,
    deleteMutation,
    skipWorkoutMutation,
  };
}
