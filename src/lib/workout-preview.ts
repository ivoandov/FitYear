import type { Exercise } from "@/data/exercises";

export interface PreviewWorkoutData {
  id: string;
  displayId: string;
  scheduledWorkoutId?: string;
  name: string;
  exercises: Exercise[];
}

export const PREVIEW_STORAGE_KEY = "workout_preview";

export function setWorkoutPreview(data: PreviewWorkoutData) {
  sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(data));
}

export function getWorkoutPreview(): PreviewWorkoutData | null {
  if (typeof window === "undefined") return null;
  const stored = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as PreviewWorkoutData;
  } catch {
    return null;
  }
}

export function clearWorkoutPreview() {
  sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
}
