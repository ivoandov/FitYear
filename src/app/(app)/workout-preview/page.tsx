"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkout } from "@/context/WorkoutContext";
import { useExerciseDetails } from "@/hooks/useExerciseDetails";
import {
  clearWorkoutPreview,
  getWorkoutPreview,
  type PreviewWorkoutData,
} from "@/lib/workout-preview";

export default function WorkoutPreviewPage() {
  const router = useRouter();
  const { startWorkout } = useWorkout();
  const { enrichExercises } = useExerciseDetails();
  const [workoutData, setWorkoutData] = useState<PreviewWorkoutData | null>(null);

  useEffect(() => {
    const data = getWorkoutPreview();
    if (data) {
      setWorkoutData(data);
    } else {
      router.push("/workouts");
    }
  }, [router]);

  if (!workoutData) {
    return null;
  }

  const enrichedExercises = enrichExercises(workoutData.exercises);

  const heroImage = enrichedExercises.find(ex => ex.imageUrl)?.imageUrl;

  const handleBeginWorkout = () => {
    startWorkout({
      id: workoutData.id,
      displayId: workoutData.displayId,
      scheduledWorkoutId: workoutData.scheduledWorkoutId,
      name: workoutData.name,
      exercises: workoutData.exercises,
    });
    clearWorkoutPreview();
    router.push("/track");
  };

  const handleBack = () => {
    clearWorkoutPreview();
    router.push("/workouts");
  };

  return (
    <div className="flex flex-col min-h-screen bg-background" data-testid="page-workout-preview">
      <div className="relative h-56 sm:h-72 overflow-hidden">
        {heroImage ? (
          <img
            src={heroImage}
            alt={workoutData.name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary/30 to-background" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />

        <div className="absolute top-0 left-0 right-0 p-4 flex items-center">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="text-white"
            data-testid="button-preview-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="ml-2 text-sm font-medium text-white/80 tracking-wide uppercase">Workout Overview</span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6">
          <h1
            className="text-4xl sm:text-5xl font-bold text-primary leading-tight"
            data-testid="text-preview-workout-name"
          >
            {workoutData.name}
          </h1>
          <p className="text-sm text-white/60 mt-1">{enrichedExercises.length} exercise{enrichedExercises.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="flex-1 px-4 sm:px-6 py-4 space-y-2.5 overflow-y-auto pb-28">
        {enrichedExercises.map((exercise, index) => (
          <div
            key={`${exercise.id}-${index}`}
            className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/50"
            data-testid={`card-preview-exercise-${exercise.id}`}
          >
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden bg-primary/10 shrink-0 flex items-center justify-center">
              {exercise.imageUrl ? (
                <img
                  src={exercise.imageUrl}
                  alt={exercise.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Dumbbell className="h-6 w-6 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm sm:text-base truncate" data-testid={`text-preview-exercise-name-${exercise.id}`}>
                {exercise.name}
              </p>
              {exercise.muscleGroups && exercise.muscleGroups.length > 0 && (
                <p className="text-xs text-muted-foreground truncate">
                  {(exercise.muscleGroups as string[]).join(" · ")}
                </p>
              )}
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-background via-background to-transparent pt-8">
        <Button
          className="w-full text-base font-semibold h-12 sm:h-14"
          onClick={handleBeginWorkout}
          data-testid="button-begin-workout"
        >
          Begin Workout
        </Button>
      </div>
    </div>
  );
}