"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Pencil, FileEdit, SkipForward, Trash2 } from "lucide-react";

interface WorkoutCardMenuProps {
  displayId: string;
  workoutId: string;
  name: string;
  templateId?: string | null;
  routineInstanceId?: string | null;
  /** Extra classes for the trigger (e.g. "text-white" over an image). */
  triggerClassName?: string;
  onEdit: (displayId: string) => void;
  onEditTemplate: (templateId: string) => void;
  onSkip: (workoutId: string) => void;
  onDelete: (displayId: string, name: string) => void;
}

/**
 * The Edit-instance / Edit-source / Skip / Delete dropdown for a scheduled
 * workout card. Was pasted verbatim on the hero + today + upcoming cards; the
 * testId scheme (`button-workout-menu-<displayId>`, etc.) is preserved.
 */
export function WorkoutCardMenu({
  displayId,
  workoutId,
  name,
  templateId,
  routineInstanceId,
  triggerClassName,
  onEdit,
  onEditTemplate,
  onSkip,
  onDelete,
}: WorkoutCardMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label={`Options for ${name}`}
          data-testid={`button-workout-menu-${displayId}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => onEdit(displayId)}
          data-testid={`button-edit-workout-${displayId}`}
        >
          <Pencil className="h-4 w-4 mr-2" />
          Edit This Instance
        </DropdownMenuItem>
        {templateId && (
          <DropdownMenuItem
            onClick={() => onEditTemplate(templateId)}
            data-testid={`button-edit-source-${displayId}`}
          >
            <FileEdit className="h-4 w-4 mr-2" />
            Edit Source Workout
          </DropdownMenuItem>
        )}
        {routineInstanceId && (
          <DropdownMenuItem
            onClick={() => onSkip(workoutId)}
            data-testid={`button-skip-workout-${displayId}`}
          >
            <SkipForward className="h-4 w-4 mr-2" />
            Skip
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onDelete(displayId, name)}
          className="text-destructive"
          data-testid={`button-delete-workout-${displayId}`}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
