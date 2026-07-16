"use client";

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MuscleFilterChips } from "@/components/MuscleFilterChips";
import { MuscleGroupsLabel } from "@/components/MuscleGroupsLabel";
import { matchesCoarse, type CoarseGroup } from "@/lib/muscle-groups";

export interface PickerExercise {
  id: string;
  name: string;
  muscleGroups: string[];
  description?: string;
  imageUrl?: string;
  exerciseType?: "weight_reps" | "distance_time";
  isAssisted?: boolean;
}

/**
 * Lightweight multi-select exercise picker used to add exercises WHILE tracking
 * a workout (the quick-start flow). No name/save gate — pick one or more and
 * tap Add; the caller appends them to the live workout. Single scroll surface
 * (sticky search header inside one scroll container) to avoid the mobile
 * nested-scroll touch-trap.
 */
export function AddExercisesSheet({
  isOpen,
  onClose,
  exercises,
  existingIds,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  exercises: PickerExercise[];
  existingIds: string[];
  onAdd: (picked: PickerExercise[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [muscle, setMuscle] = useState<string>("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const existing = useMemo(() => new Set(existingIds), [existingIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (muscle !== "All" && !matchesCoarse(ex.muscleGroups ?? [], muscle as CoarseGroup)) return false;
      if (q && !ex.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [exercises, search, muscle]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setSearch("");
    setMuscle("All");
    setSelected(new Set());
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleAdd = () => {
    const picked = exercises.filter((ex) => selected.has(ex.id));
    if (picked.length === 0) return;
    onAdd(picked);
    reset();
    onClose();
  };

  return (
    <Sheet open={isOpen} onOpenChange={(o: boolean) => !o && handleClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto p-0"
        data-testid="sheet-add-exercises"
      >
        {/* Sticky header: stays put while the list scrolls. Single scroll
            surface (this SheetContent), so no nested-scroll touch-trap. */}
        <div className="sticky top-0 z-10 bg-card border-b">
          <SheetHeader className="px-6 pt-6 pb-3">
            <SheetTitle>Add exercises</SheetTitle>
          </SheetHeader>
          <div className="px-6 pb-3 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search exercises…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-add-exercise-search"
              />
            </div>
            <MuscleFilterChips exercises={exercises} value={muscle} onChange={setMuscle} />
          </div>
        </div>

        <div className="px-6 py-3 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No exercises match.
            </p>
          ) : (
            filtered.map((ex) => {
              const isAdded = existing.has(ex.id);
              const isChecked = selected.has(ex.id);
              return (
                <button
                  key={ex.id}
                  type="button"
                  disabled={isAdded}
                  onClick={() => toggle(ex.id)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    isAdded
                      ? "opacity-50 cursor-not-allowed"
                      : isChecked
                        ? "border-yellow bg-primary-dim"
                        : "hover:bg-white/[0.03]",
                  )}
                  data-testid={`add-exercise-row-${ex.id}`}
                >
                  <Checkbox checked={isChecked} disabled={isAdded} className="pointer-events-none" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm line-clamp-2 leading-snug">{ex.name}</div>
                    {ex.muscleGroups?.length ? (
                      <MuscleGroupsLabel groups={ex.muscleGroups} className="text-xs truncate" />
                    ) : null}
                  </div>
                  {isAdded ? (
                    <span className="text-xs text-muted-foreground shrink-0">Added</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        {/* Sticky footer action */}
        <div className="sticky bottom-0 bg-gradient-to-t from-card via-card to-transparent px-6 pt-4 pb-6">
          <button
            type="button"
            onClick={handleAdd}
            disabled={selected.size === 0}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 font-bold text-primary-foreground shadow-cta transition-opacity hover:opacity-90 disabled:opacity-50"
            data-testid="button-add-exercises-confirm"
          >
            <Check className="h-4 w-4" />
            {selected.size === 0 ? "Select exercises to add" : `Add ${selected.size}`}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
