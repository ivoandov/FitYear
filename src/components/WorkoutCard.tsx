"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Play } from "lucide-react";
import { format } from "date-fns";

interface WorkoutCardProps {
  id: string;
  name: string;
  date: Date;
  exerciseCount: number;
  duration?: number;
  onStart?: (id: string) => void;
}

export function WorkoutCard({
  id,
  name,
  date,
  exerciseCount,
  duration,
  onStart,
}: WorkoutCardProps) {
  return (
    <Card className="hover-elevate" data-testid={`card-workout-${id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-5 sm:p-7 pb-2 sm:pb-2">
        <CardTitle className="text-base sm:text-lg font-semibold truncate" data-testid={`text-workout-name-${id}`}>
          {name}
        </CardTitle>
        <Button
          size="icon"
          onClick={() => onStart?.(id)}
          data-testid={`button-start-workout-${id}`}
        >
          <Play className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="p-5 sm:p-7 pt-0 sm:pt-0">
        <div className="flex flex-col gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
            <span data-testid={`text-date-${id}`}>{format(date, "PP")}</span>
          </div>
          <div className="flex items-center gap-2">
            <span data-testid={`text-exercise-count-${id}`}>
              {exerciseCount} exercises
            </span>
          </div>
          {duration && (
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
              <span data-testid={`text-duration-${id}`}>{duration} min</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}