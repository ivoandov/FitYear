"use client";

import { memo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
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
import { Plus, Pencil, X, RefreshCw, TrendingUp } from "lucide-react";

interface ExerciseCardProps {
  id: string;
  name: string;
  muscleGroups: string[];
  description: string;
  imageUrl?: string | null;
  exerciseType?: string | null;
  // True only when the current user owns this exercise. Gates all mutating
  // controls (Edit / Delete / Regenerate). Non-owned + default-library
  // exercises are view-only (Add to Workout + Progress still available).
  isOwner?: boolean;
  isRegenerating?: boolean;
  onAdd?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRegenerateImage?: (id: string) => void;
}

function ExerciseCardImpl({
  id,
  name,
  muscleGroups,
  description,
  imageUrl,
  isOwner = false,
  isRegenerating = false,
  onEdit,
  onAdd,
  onDelete,
  onRegenerateImage,
}: ExerciseCardProps) {
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    onDelete?.(id);
    setShowDeleteDialog(false);
  };

  return (
    <>
      <Card className="overflow-hidden hover-elevate relative" data-testid={`card-exercise-${id}`}>
        {imageUrl ? (
          <div 
            className="aspect-[16/10] sm:aspect-video overflow-hidden cursor-pointer relative"
            onClick={() => setShowImageDialog(true)}
            data-testid={`image-container-${id}`}
          >
            <Image
              src={imageUrl}
              alt={name}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover hover:scale-105 transition-transform duration-200"
            />
            <div className="absolute top-0 right-0 w-14 h-14 bg-[radial-gradient(ellipse_at_top_right,rgba(0,0,0,0.4)_0%,transparent_70%)] pointer-events-none" />
            {isOwner && (
              <button
                className="absolute top-2 right-2 text-white drop-shadow-lg hover:text-red-400 transition-colors z-10"
                onClick={handleDeleteClick}
                data-testid={`button-delete-exercise-${id}`}
              >
                <X className="h-6 w-6" strokeWidth={3} />
              </button>
            )}
            {isOwner && onRegenerateImage && (
              <button
                className="absolute bottom-2 left-2 text-white drop-shadow-lg hover:text-primary transition-colors z-10 p-1 rounded-full bg-black/30 backdrop-blur-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRegenerateImage(id);
                }}
                disabled={isRegenerating}
                data-testid={`button-regenerate-image-${id}`}
              >
                <RefreshCw className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`} strokeWidth={2.5} />
              </button>
            )}
          </div>
        ) : isOwner ? (
          <button
            className="absolute top-2 right-2 text-muted-foreground hover:text-red-500 transition-colors z-10"
            onClick={handleDeleteClick}
            data-testid={`button-delete-exercise-${id}`}
          >
            <X className="h-5 w-5" strokeWidth={2.5} />
          </button>
        ) : null}
        <CardHeader className="space-y-2 p-4 sm:p-6">
          <div className="flex gap-1.5 sm:gap-2 flex-wrap">
            {muscleGroups.map((group) => (
              <Badge key={group} variant="secondary" className="text-xs" data-testid={`badge-muscle-${id}-${group.toLowerCase()}`}>
                {group}
              </Badge>
            ))}
          </div>
          <Link
            href={`/exercises/${id}`}
            className="block hover:underline"
            data-testid={`link-exercise-detail-${id}`}
          >
            <CardTitle className="text-base sm:text-lg" data-testid={`text-exercise-name-${id}`}>
              {name}
            </CardTitle>
          </Link>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
          <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2" data-testid={`text-description-${id}`}>
            {description}
          </p>
        </CardContent>
        <CardFooter className="p-4 sm:p-6 pt-0 sm:pt-0 gap-2">
          {isOwner && (
            <Button
              onClick={() => onEdit?.(id)}
              variant="outline"
              size="sm"
              data-testid={`button-edit-exercise-${id}`}
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </Button>
          )}
          <Link
            href={`/exercises/${id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
            data-testid={`button-progress-exercise-${id}`}
          >
            <TrendingUp className="h-4 w-4 mr-2" />
            Progress
          </Link>
          <Button
            onClick={() => onAdd?.(id)}
            className="flex-1"
            size="sm"
            data-testid={`button-add-exercise-${id}`}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add to Workout
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={showImageDialog} onOpenChange={setShowImageDialog}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden bg-transparent border-none">
          <VisuallyHidden>
            <DialogTitle>{name} - Exercise Image</DialogTitle>
            <DialogDescription>Full size image of the {name} exercise</DialogDescription>
          </VisuallyHidden>
          <div className="relative">
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-4 right-4 z-10 rounded-full bg-background/80 backdrop-blur-sm h-12 w-12"
              onClick={() => setShowImageDialog(false)}
              data-testid={`button-close-image-${id}`}
            >
              <X className="h-8 w-8" />
            </Button>
            {imageUrl && (
              <img
                src={imageUrl}
                alt={name}
                className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
                data-testid={`image-fullsize-${id}`}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent data-testid={`dialog-confirm-delete-exercise-${id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Exercise</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`button-cancel-delete-exercise-${id}`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`button-confirm-delete-exercise-${id}`}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Cards are pure given props; muscleGroups array identity comes from the parent's
// memoized allExercises so the shallow compare here is reliable. Skips re-renders
// on unrelated parent state changes (search input, regen toggles for *other* cards).
export const ExerciseCard = memo(ExerciseCardImpl);