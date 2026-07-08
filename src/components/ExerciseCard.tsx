"use client";

import { memo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
import { Plus, Pencil, X, RefreshCw, TrendingUp, Dumbbell } from "lucide-react";

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
      <div className="card-elevated relative flex flex-col overflow-hidden" data-testid={`card-exercise-${id}`}>
        {imageUrl ? (
          <div
            className="relative aspect-[16/10] cursor-pointer overflow-hidden"
            onClick={() => setShowImageDialog(true)}
            data-testid={`image-container-${id}`}
          >
            <Image
              src={imageUrl}
              alt={name}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover transition-transform duration-200 hover:scale-105"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/25" />
            {isOwner && (
              <button
                className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:text-destructive"
                onClick={handleDeleteClick}
                aria-label={`Delete ${name}`}
                data-testid={`button-delete-exercise-${id}`}
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
            {isOwner && onRegenerateImage && (
              <button
                className="absolute bottom-2 left-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:text-primary disabled:opacity-60"
                onClick={(e) => {
                  e.stopPropagation();
                  onRegenerateImage(id);
                }}
                disabled={isRegenerating}
                aria-label={`Regenerate image for ${name}`}
                data-testid={`button-regenerate-image-${id}`}
              >
                <RefreshCw className={`h-4 w-4 ${isRegenerating ? "animate-spin" : ""}`} strokeWidth={2.25} />
              </button>
            )}
          </div>
        ) : (
          <div className="relative aspect-[16/10] overflow-hidden bg-primary-dim">
            <div className="absolute inset-0 flex items-center justify-center">
              <Dumbbell className="h-9 w-9 text-primary/70" strokeWidth={1.75} />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            {isOwner && (
              <button
                className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:text-destructive"
                onClick={handleDeleteClick}
                aria-label={`Delete ${name}`}
                data-testid={`button-delete-exercise-${id}`}
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
            {isOwner && onRegenerateImage && (
              <button
                className="absolute bottom-2 left-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:text-primary disabled:opacity-60"
                onClick={(e) => {
                  e.stopPropagation();
                  onRegenerateImage(id);
                }}
                disabled={isRegenerating}
                aria-label={`Regenerate image for ${name}`}
                data-testid={`button-regenerate-image-${id}`}
              >
                <RefreshCw className={`h-4 w-4 ${isRegenerating ? "animate-spin" : ""}`} strokeWidth={2.25} />
              </button>
            )}
          </div>
        )}

        <div className="flex flex-1 flex-col p-4">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {muscleGroups.map((group) => (
              <span
                key={group}
                className="rounded-md bg-white/[0.06] px-2.5 py-[3px] text-[11px] text-muted-foreground"
                data-testid={`badge-muscle-${id}-${group.toLowerCase()}`}
              >
                {group}
              </span>
            ))}
          </div>

          <Link
            href={`/exercises/${id}`}
            className="block"
            data-testid={`link-exercise-detail-${id}`}
          >
            <h3
              className="text-[17px] font-bold leading-snug text-foreground hover:underline"
              data-testid={`text-exercise-name-${id}`}
            >
              {name}
            </h3>
          </Link>

          <p
            className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground line-clamp-2"
            data-testid={`text-description-${id}`}
          >
            {description}
          </p>

          <div className="mt-auto flex gap-2.5 pt-3.5">
            {isOwner && (
              <button
                type="button"
                onClick={() => onEdit?.(id)}
                aria-label={`Edit ${name}`}
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border-strong text-muted-foreground transition-colors hover:text-foreground"
                data-testid={`button-edit-exercise-${id}`}
              >
                <Pencil className="h-[15px] w-[15px]" />
              </button>
            )}
            <Link
              href={`/exercises/${id}`}
              className="flex h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl border-strong px-4 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              data-testid={`button-progress-exercise-${id}`}
            >
              <TrendingUp className="h-[15px] w-[15px]" />
              Progress
            </Link>
            <button
              type="button"
              onClick={() => onAdd?.(id)}
              className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-[13px] font-bold text-primary-foreground"
              data-testid={`button-add-exercise-${id}`}
            >
              <Plus className="h-[15px] w-[15px]" strokeWidth={2.5} />
              Add to Workout
            </button>
          </div>
        </div>
      </div>

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