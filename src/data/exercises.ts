export type ExerciseType = "weight_reps" | "distance_time";

// App-side Exercise type. The seeded library used to live here but is now in
// the DB after the Phase 2 migration. Kept loose so the editor can pre-populate
// new exercises before they're persisted.
export interface Exercise {
  id: string;
  userId?: string | null;
  isPublic?: boolean;
  name: string;
  muscleGroups: string[];
  description: string;
  imageUrl?: string | null;
  exerciseType?: string | null;
  isAssisted?: boolean;
  // Computed/runtime-only fields used by the editor and tracking screens.
  // Not persisted as columns — sets data lives on completed_workouts.
  setsData?: unknown[];
  completedSets?: number;
}
