"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AddExerciseDialog, type ExerciseFormData } from "@/components/AddExerciseDialog";
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
import { apiRequest, describeApiError, queryClient } from "@/lib/queryClient";
import { duplicateMatchFrom } from "@/lib/exercise-duplicate";
import { useToast } from "@/hooks/use-toast";
import type { ExerciseType } from "@/lib/exercise-types";

/** What the caller gets back: the exercise to put in the workout. */
export type CreatedExercise = {
  id: string;
  name: string;
  muscleGroups: string[];
  description?: string;
  exerciseType?: ExerciseType;
  isAssisted?: boolean;
};

type Pending = {
  name: string;
  muscleGroups: string[];
  description: string;
  exerciseType: string;
  isAssisted: boolean;
};

/**
 * Create an exercise from somewhere other than the Exercises page, and hand it
 * straight back.
 *
 * Ivo, 2026-09-30: "I also wish I could add a new exercise to the database
 * from the 'Add Exercise' menu if I dont see what I want." Mid-workout, the
 * alternative was abandoning the tracker to visit the Exercises page.
 *
 * It goes through the same `POST /api/exercises` as everywhere else, so the
 * name is canonicalised and the DUPLICATE GUARD still runs: a near-match
 * answers 409, and the person chooses between the existing exercise and
 * creating theirs anyway, exactly as on the Exercises page. Either choice comes
 * back through `onCreated`, so the caller never has to know which happened.
 *
 * It deliberately does NOT generate an image. Images are ON DEMAND (Ivo,
 * 2026-09-30: "i want ai on demand"): the exercise is created imageless and its
 * card's "Generate image" button is the only way one gets made. Nothing creates
 * an image automatically, here or anywhere else.
 */
export function CreateExerciseFlow({
  open,
  initialName,
  library,
  onCreated,
  onClose,
}: {
  open: boolean;
  initialName: string;
  /** The catalog, for the live similar-name hint and to resolve "use existing". */
  library: CreatedExercise[];
  onCreated: (exercise: CreatedExercise) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [duplicate, setDuplicate] = useState<{ pending: Pending; match: { id: string; name: string } } | null>(null);

  const create = useMutation({
    mutationFn: async (body: Pending & { force?: boolean }) => {
      const res = await apiRequest("POST", "/api/exercises", body);
      return (await res.json()) as CreatedExercise;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      setDuplicate(null);
      onCreated(created);
    },
    onError: (error, variables) => {
      const match = duplicateMatchFrom(error);
      if (match) {
        setDuplicate({ pending: variables, match });
        return;
      }
      toast({ title: "Couldn't create exercise", description: describeApiError(error), variant: "destructive" });
    },
  });

  const useExisting = () => {
    if (!duplicate) return;
    const existing = library.find((e) => e.id === duplicate.match.id);
    setDuplicate(null);
    // The guard only matches what is in the catalog, so this is found; the
    // fallback keeps the id and name, which is all a workout needs.
    onCreated(existing ?? { id: duplicate.match.id, name: duplicate.match.name, muscleGroups: [] });
  };

  // Seeds the form's NAME only; the person is mid-workout, so nothing else is
  // guessed. MEMOIZED, and it has to be: the dialog re-applies initialData
  // whenever that object changes, so a fresh object each render would wipe
  // whatever was being typed every time the tracker re-rendered.
  const seed = useMemo<ExerciseFormData | null>(
    () =>
      open
        ? {
            name: initialName,
            muscleGroups: [],
            description: "",
            exerciseType: "weight_reps",
            isAssisted: false,
          }
        : null,
    [open, initialName],
  );

  return (
    <>
      <AddExerciseDialog
        isOpen={open && !duplicate}
        onClose={onClose}
        onSave={(data) =>
          create.mutate({
            name: data.name,
            muscleGroups: data.muscleGroups,
            description: data.description,
            exerciseType: data.exerciseType,
            isAssisted: data.isAssisted,
          })
        }
        isPending={create.isPending}
        initialData={seed}
        mode="add"
        library={library}
      />

      <AlertDialog open={!!duplicate} onOpenChange={(o) => !o && setDuplicate(null)}>
        <AlertDialogContent data-testid="dialog-create-duplicate">
          <AlertDialogHeader>
            <AlertDialogTitle>Already in the library?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{duplicate?.match.name}&quot; looks like the same exercise. Using it keeps
              your history in one place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-create-anyway"
              onClick={() => duplicate && create.mutate({ ...duplicate.pending, force: true })}
            >
              Create mine anyway
            </AlertDialogCancel>
            <AlertDialogAction data-testid="button-use-existing" onClick={useExisting}>
              Use {duplicate?.match.name}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
