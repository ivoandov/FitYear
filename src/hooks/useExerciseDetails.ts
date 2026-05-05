"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Exercise } from "@/lib/db/schema";

interface StoredExercise {
  id: string;
  name?: string;
  description?: string;
  imageUrl?: string | null;
  muscleGroups?: string[] | unknown;
  exerciseType?: string | null;
  isAssisted?: boolean;
  [key: string]: unknown;
}

interface EnrichedExercise extends StoredExercise {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  muscleGroups: string[];
  exerciseType: string;
  isAssisted: boolean;
}

export function useExerciseDetails() {
  const { data: allExercises = [] } = useQuery<Exercise[]>({
    queryKey: ["/api/exercises"],
  });

  const getExerciseById = useCallback(
    (id: string): Exercise | undefined => {
      return allExercises.find((ex) => ex.id === id);
    },
    [allExercises],
  );

  const enrichExercise = useCallback(
    <T extends StoredExercise>(stored: T): T & EnrichedExercise => {
      const src = allExercises.find((ex) => ex.id === stored.id);
      if (src) {
        return {
          ...stored,
          name: src.name,
          description: src.description,
          imageUrl: src.imageUrl,
          muscleGroups: src.muscleGroups as string[],
          exerciseType: src.exerciseType,
          isAssisted: src.isAssisted,
        } as T & EnrichedExercise;
      }
      return {
        ...stored,
        name: stored.name || "Unknown Exercise",
        description: stored.description || "",
        imageUrl: stored.imageUrl || null,
        muscleGroups: (stored.muscleGroups as string[]) || [],
        exerciseType: stored.exerciseType || "weight_reps",
        isAssisted: stored.isAssisted || false,
      } as T & EnrichedExercise;
    },
    [allExercises],
  );

  const enrichExercises = useCallback(
    <T extends StoredExercise>(items: T[]): (T & EnrichedExercise)[] => {
      return items.map((ex) => enrichExercise(ex));
    },
    [enrichExercise],
  );

  return { allExercises, getExerciseById, enrichExercise, enrichExercises };
}
