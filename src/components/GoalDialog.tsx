"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Exercise } from "@/lib/db/schema";

interface GoalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editGoal?: { id: string; exerciseId: string; exerciseName: string; targetReps: number } | null;
}

export function GoalDialog({ isOpen, onClose, editGoal }: GoalDialogProps) {
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [targetReps, setTargetReps] = useState("");
  const [search, setSearch] = useState("");

  const { data: exercises = [] } = useQuery<Exercise[]>({ queryKey: ["/api/exercises"] });

  useEffect(() => {
    if (isOpen) {
      if (editGoal) {
        setSelectedExerciseId(editGoal.exerciseId);
        setTargetReps(String(editGoal.targetReps));
      } else {
        setSelectedExerciseId("");
        setTargetReps("");
      }
      setSearch("");
    }
  }, [isOpen, editGoal]);

  const createMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/exercise-goals", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercise-goals"] });
      onClose();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => apiRequest("PUT", `/api/exercise-goals/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercise-goals"] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/exercise-goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/exercise-goals"] });
      onClose();
    },
  });

  const weightRepsExercises = (exercises as Exercise[]).filter(e => e.exerciseType !== "distance_time");
  const filtered = weightRepsExercises.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));
  const selectedExercise = exercises.find(e => e.id === selectedExerciseId);

  const handleSave = () => {
    const reps = parseInt(targetReps);
    if (!selectedExerciseId || !reps || reps <= 0) return;
    const exerciseName = selectedExercise?.name ?? "";
    if (editGoal) {
      updateMutation.mutate({ id: editGoal.id, body: { exerciseName, targetReps: reps } });
    } else {
      createMutation.mutate({ exerciseId: selectedExerciseId, exerciseName, targetReps: reps, period: "week" });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-goal">
        <DialogHeader>
          <DialogTitle>{editGoal ? "Edit Goal" : "New Weekly Goal"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Exercise</Label>
            {editGoal ? (
              <div className="px-3 py-2 rounded-md bg-muted text-sm font-medium">{editGoal.exerciseName}</div>
            ) : (
              <>
                <Input
                  placeholder="Search exercises..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  data-testid="input-goal-search"
                />
                <Select value={selectedExerciseId} onValueChange={(v) => setSelectedExerciseId(v ?? "")}>
                  <SelectTrigger data-testid="select-goal-exercise">
                    <SelectValue placeholder="Select exercise" />
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {filtered.map(ex => (
                      <SelectItem key={ex.id} value={ex.id} data-testid={`option-exercise-${ex.id}`}>
                        {ex.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-target">Weekly target (reps)</Label>
            <Input
              id="goal-target"
              type="number"
              min={1}
              placeholder="e.g. 50"
              value={targetReps}
              onChange={e => setTargetReps(e.target.value)}
              data-testid="input-goal-target"
            />
          </div>

          <div className="flex gap-2 pt-1">
            {editGoal && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => deleteMutation.mutate(editGoal.id)}
                disabled={deleteMutation.isPending}
                data-testid="button-delete-goal"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button
              className="flex-1"
              onClick={handleSave}
              disabled={!selectedExerciseId || !targetReps || isPending}
              data-testid="button-save-goal"
            >
              {isPending ? "Saving..." : editGoal ? "Save Changes" : "Add Goal"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}