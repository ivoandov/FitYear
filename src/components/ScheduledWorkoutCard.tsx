"use client";

import { format } from "date-fns";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
      <Card className="border-0 h-full flex flex-col relative overflow-hidden">
        {imageUrl && (
          <>
            <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />
          </>
        )}
        <div className="relative flex items-start justify-between p-4 sm:p-5 z-10">
          <CardTitle className={`text-lg sm:text-xl ${titleExtraClass} font-semibold flex-1 break-words line-clamp-2 ${imageUrl ? "text-white" : ""}`}>
            {workout.name}
          </CardTitle>
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
          <div className="px-4 sm:px-5 flex-1 flex items-center justify-center">
            <Dumbbell className="h-12 w-12 sm:h-14 sm:w-14 text-primary opacity-60" />
          </div>
        )}
        {imageUrl && <div className="flex-1" />}
        <div className="relative px-4 sm:px-5 pb-4 sm:pb-5 flex items-center justify-between gap-2 z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`text-sm sm:text-base ${imageUrl ? "text-white/70" : "text-muted-foreground"}`}>
              {format(workout.date, "MMM d, yyyy")}
            </p>
            {badges}
          </div>
          <Button
            size="icon"
            className="shrink-0 aspect-square"
            onClick={() => onStart(workout.displayId)}
            data-testid={`button-start-workout-${workout.displayId}`}
          >
            <Play className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
