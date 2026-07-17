"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/components/SettingsProvider";
import { nameMatchScore, DEFAULT_MATCH_THRESHOLD } from "@/lib/exercise-match";

export type ExerciseType = "weight_reps" | "distance_time";

export interface ExerciseFormData {
  id?: string;
  name: string;
  muscleGroups: string[];
  description: string;
  exerciseType: ExerciseType;
  isAssisted: boolean;
}

interface AddExerciseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ExerciseFormData) => void;
  isPending?: boolean;
  initialData?: ExerciseFormData | null;
  mode?: "add" | "edit";
  /** Existing catalog, for the live similar-name hint (dup prevention). */
  library?: Array<{ id: string; name: string }>;
}

export function AddExerciseDialog({
  isOpen,
  onClose,
  onSave,
  isPending = false,
  initialData = null,
  mode = "add",
  library = [],
}: AddExerciseDialogProps) {
  const { muscleGroups } = useSettings();
  const [name, setName] = useState("");
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [exerciseType, setExerciseType] = useState<ExerciseType>("weight_reps");
  const [isAssisted, setIsAssisted] = useState(false);

  useEffect(() => {
    if (initialData && isOpen) {
      setName(initialData.name);
      setSelectedMuscleGroups(initialData.muscleGroups);
      setDescription(initialData.description);
      setExerciseType(initialData.exerciseType || "weight_reps");
      setIsAssisted(initialData.isAssisted || false);
    } else if (!isOpen) {
      setName("");
      setSelectedMuscleGroups([]);
      setDescription("");
      setExerciseType("weight_reps");
      setIsAssisted(false);
    }
  }, [initialData, isOpen]);

  const handleMuscleGroupToggle = (group: string) => {
    setSelectedMuscleGroups(prev => 
      prev.includes(group) 
        ? prev.filter(g => g !== group)
        : [...prev, group]
    );
  };

  const handleSave = () => {
    if (!name || selectedMuscleGroups.length === 0) return;
    onSave({ 
      id: initialData?.id,
      name, 
      muscleGroups: selectedMuscleGroups, 
      description, 
      exerciseType,
      isAssisted
    });
  };

  const handleClose = () => {
    setName("");
    setSelectedMuscleGroups([]);
    setDescription("");
    setExerciseType("weight_reps");
    setIsAssisted(false);
    onClose();
  };

  const isValid = name && selectedMuscleGroups.length > 0;
  const isEditMode = mode === "edit";

  // Live duplicate hint: surface the closest existing names while typing so
  // the user picks the library exercise instead of minting a near-duplicate.
  // (The API's duplicate guard is the backstop; this is the friendly nudge.)
  const similar = useMemo(() => {
    const q = name.trim();
    if (q.length < 3) return [] as Array<{ name: string; score: number }>;
    return library
      .filter((e) => e.id !== initialData?.id)
      .map((e) => ({ name: e.name, score: nameMatchScore(q, e.name) }))
      .filter((e) => e.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [name, library, initialData?.id]);
  const strongDuplicate = similar.length > 0 && similar[0].score >= DEFAULT_MATCH_THRESHOLD;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit Exercise" : "Add New Exercise"}</DialogTitle>
          <DialogDescription>
            {isEditMode 
              ? "Update the exercise details" 
              : "Create a custom exercise for your workout library"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Exercise Name</Label>
            <Input
              id="name"
              placeholder="e.g., Romanian Deadlift"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-exercise-name"
            />
            {similar.length > 0 && (
              <p
                className={`text-xs ${strongDuplicate ? "text-primary" : "text-muted-foreground"}`}
                data-testid="text-similar-exercises"
              >
                {strongDuplicate
                  ? `Already in the library: ${similar[0].name}`
                  : `Similar: ${similar.map((s) => s.name).join(", ")}`}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <Select value={exerciseType} onValueChange={(v) => setExerciseType(v as ExerciseType)}>
              <SelectTrigger data-testid="select-exercise-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weight_reps">Weight and Reps</SelectItem>
                <SelectItem value="distance_time">Distance and Time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {exerciseType === "weight_reps" && (
            <div className="flex items-center space-x-2 py-2">
              <Checkbox
                id="is-assisted"
                checked={isAssisted}
                onCheckedChange={(checked) => setIsAssisted(checked === true)}
                data-testid="checkbox-is-assisted"
              />
              <label
                htmlFor="is-assisted"
                className="text-sm font-medium leading-none cursor-pointer"
              >
                Assisted exercise
              </label>
              <span className="text-xs text-muted-foreground">
                (less weight = more progress)
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label>Muscle Groups</Label>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {muscleGroups.map((group) => (
                <div key={group} className="flex items-center space-x-2">
                  <Checkbox
                    id={`muscle-${group}`}
                    checked={selectedMuscleGroups.includes(group)}
                    onCheckedChange={() => handleMuscleGroupToggle(group)}
                    data-testid={`checkbox-muscle-${group.toLowerCase()}`}
                  />
                  <label
                    htmlFor={`muscle-${group}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    {group}
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Notes (Optional)</Label>
            <Textarea
              id="description"
              placeholder="Add any notes about this exercise..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[100px]"
              data-testid="input-description"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!isValid || isPending}
            data-testid="button-save-exercise"
          >
            {isPending ? "Saving..." : isEditMode ? "Save Changes" : "Add Exercise"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}