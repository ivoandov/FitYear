"use client";

import { format } from "date-fns";
import { Dumbbell, Play } from "lucide-react";
import { WorkoutCardMenu } from "@/components/WorkoutCardMenu";

interface ScheduledWorkoutCardProps {
  workout: {
    id: string;
    displayId: string;
    name: string;
    date: Date;
    templateId?: string;
    routineInstanceId?: string | null;
  };
  imageUrl: string | null;
  /** Extra title classes (upcoming cards bump the md size). */
  titleExtraClass?: string;
  /** Caller-computed badge row (Done / Past Due / routine / Original). */
  badges?: React.ReactNode;
  onStart: (displayId: string) => void;
  onEdit: (displayId: string) => void;
  onEditTemplate: (templateId: string) => void;
  onSkip: (workoutId: string) => void;
  onDelete: (displayId: string, name: string) => void;
}

/**
 * The square scheduled-workout card used in the home Today + Upcoming grids.
 * Unifies two near-identical inline renderings; the only differences (title
 * size + which badges show) are props. testIds preserved.
 */
export function ScheduledWorkoutCard({
  workout,
  imageUrl,
  titleExtraClass = "",
  badges,
  onStart,
  onEdit,
  onEditTemplate,
  onSkip,
  onDelete,
}: ScheduledWorkoutCardProps) {
  return (
    <div className="aspect-square" data-testid={`card-workout-${workout.displayId}`}>
      <div
        className={`relative flex h-full flex-col overflow-hidden rounded-[18px] ${
          imageUrl ? "bg-card" : "card-elevated"
        }`}
      >
        {imageUrl && (
          <>
            <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
          </>
        )}
        <div className="relative z-10 flex items-start justify-between p-4">
          <h3
            className={`flex-1 break-words line-clamp-2 text-lg sm:text-xl ${titleExtraClass} font-semibold ${
              imageUrl ? "text-white" : "text-foreground"
            }`}
          >
            {workout.name}
          </h3>
          <WorkoutCardMenu
            displayId={workout.displayId}
            workoutId={workout.id}
            name={workout.name}
            templateId={workout.templateId}
            routineInstanceId={workout.routineInstanceId}
            triggerClassName={imageUrl ? "text-white" : undefined}
            onEdit={onEdit}
            onEditTemplate={onEditTemplate}
            onSkip={onSkip}
            onDelete={onDelete}
          />
        </div>
        {!imageUrl && (
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-primary-dim">
              <Dumbbell className="h-7 w-7 text-primary" />
            </div>
          </div>
        )}
        {imageUrl && <div className="flex-1" />}
        <div className="relative z-10 flex items-center justify-between gap-2 p-4 pt-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={`font-mono text-[11px] uppercase tracking-[0.04em] ${
                imageUrl ? "text-white/70" : "text-tertiary-foreground"
              }`}
            >
              {format(workout.date, "MMM d, yyyy")}
            </span>
            {badges}
          </div>
          <button
            type="button"
            onClick={() => onStart(workout.displayId)}
            aria-label={`Start ${workout.name}`}
            data-testid={`button-start-workout-${workout.displayId}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-dim text-primary"
          >
            <Play className="h-4 w-4 fill-current" />
          </button>
        </div>
      </div>
    </div>
  );
}
