"use client";

import { Pencil, Check, X, Plus, Trash2, RefreshCw, Trophy, Play } from "lucide-react";
import { format } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { useWorkout } from "@/context/WorkoutContext";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useExerciseDetails } from "@/hooks/useExerciseDetails";
import {
  lbsToDisplay as lbsToDisplayShared,
  displayToLbs as displayToLbsShared,
} from "@/lib/units";
import { type SetData } from "@/lib/workout-stats";
import { localDateKey } from "@/lib/date";
import { formatDuration, parseDurationInput } from "@/lib/workout-duration";
import { usesDistance, usesTime } from "@/lib/exercise-types";

// DB always stores weights in lbs. Display + edit in user's preferred unit;
// convert back to lbs before saving. These thin wrappers route through the
// shared lib/units convention (round to 1 decimal) but coerce the shared
// `number | null` result to `undefined`, since SetDetail's `weight?: number`
// is undefined (not null) to match the API/DB JSON shape.
function lbsToDisplay(lbs: number | null | undefined, unit: 'lbs' | 'kg'): number | undefined {
  return lbsToDisplayShared(lbs, unit) ?? undefined;
}
function displayToLbs(val: number | null | undefined, unit: 'lbs' | 'kg'): number | undefined {
  return displayToLbsShared(val, unit) ?? undefined;
}

// The edit form needs every field optional (empty inputs), so this is the
// canonical SetData with all fields optional rather than a separate shape.
type SetDetail = Partial<SetData>;

interface ExerciseDetail {
  id?: string;
  name: string;
  muscleGroups?: string[];
  exerciseType?: string;
  // Preserved through an edit so assisted-lift records keep their inverted
  // (lower weight = better) semantics.
  isAssisted?: boolean;
  sets: SetDetail[];
  setsData?: SetDetail[];
}

interface WorkoutHistoryCardProps {
  id: string;
  workoutId?: string;
  workoutName: string;
  date: Date;
  duration: number;
  exerciseCount: number;
  totalVolume: number;
  totalSets?: number;
  exercises?: ExerciseDetail[];
  calendarEventId?: string | null;
}

export function WorkoutHistoryCard({
  id,
  workoutId,
  workoutName,
  date,
  duration,
  exerciseCount,
  totalVolume,
  totalSets = 0,
  exercises = [],
  calendarEventId,
}: WorkoutHistoryCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [editedExercises, setEditedExercises] = useState<ExerciseDetail[]>([]);
  // Duration is editable because forgetting to press Finish inflates it. The
  // client now trims an obvious idle tail automatically, but only the user
  // knows the real number when the trim cannot tell.
  const [editedDuration, setEditedDuration] = useState("");
  const { updateCompletedWorkout, completedWorkouts, resumeWorkout } = useWorkout();
  const { toast } = useToast();
  const { enrichExercises } = useExerciseDetails();

  const { data: userSettingsData } = useQuery<{ weightUnit?: string }>({ queryKey: ['/api/user-settings'] });
  const weightUnit = (userSettingsData?.weightUnit ?? 'lbs') as 'lbs' | 'kg';

  const enrichedExercises = useMemo(() => {
    return enrichExercises(exercises.map(ex => ({ ...ex, id: ex.id || "" })));
  }, [exercises, enrichExercises]);

  const syncCalendarMutation = useMutation({
    mutationFn: async () => {
      const localDateStr = localDateKey(date);
      return apiRequest("POST", `/api/completed-workouts/${workoutId}/sync-calendar`, { localDate: localDateStr });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/completed-workouts"] });
      toast({
        title: "Synced to Calendar",
        description: `"${workoutName}" has been added to your Google Calendar`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync workout to Google Calendar",
        variant: "destructive",
      });
    },
  });

  const completedSets = totalSets || enrichedExercises.reduce((total, ex) => 
    total + ex.sets.filter(s => s.completed).length, 0
  );

  /**
   * Pick this workout back up. Ivo runs out of time part way through, finishes,
   * and comes back an hour later; without this the only options were to edit
   * the numbers by hand or start a second workout for the same session.
   */
  const handleContinue = () => {
    const record = completedWorkouts.find((w) => w.id === workoutId);
    if (!record) return;
    if (!resumeWorkout(record)) {
      toast({
        title: "Nothing to continue",
        description: "That workout has no exercises to pick up.",
        variant: "destructive",
      });
      return;
    }
    router.push("/track");
  };

  const startEditing = () => {
    // Convert stored lbs → display unit when pre-filling edit inputs so the
    // numbers the user sees match the unit label they see.
    setEditedExercises(enrichedExercises.map(ex => {
      const sets = ex.sets.length > 0
        ? ex.sets.map(s => ({ ...s, weight: lbsToDisplay(s.weight, weightUnit) }))
        // Not logged: an exercise with NO rows at all was never opened, so it
        // gets one blank row to type into rather than a set claiming to have
        // happened. Typing in it (or ticking it) is what logs it.
        : [{ setNumber: 1, completed: false }];
      return {
        ...ex,
        sets,
      };
    }));
    setEditedDuration(formatDuration(duration));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditedExercises([]);
    setEditedDuration("");
  };

  const [isSaving, setIsSaving] = useState(false);

  const saveEditing = async () => {
    if (!workoutId) return;
    
    // Convert display-unit weights back to lbs before persisting (DB always stores lbs).
    const updatedExercises = editedExercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      muscleGroups: ex.muscleGroups || [],
      exerciseType: ex.exerciseType || 'weight_reps',
      // Carry the assisted flag through: the edit rewrites the normalized rows
      // wholesale, so omitting it stored null and the all-time record for an
      // assisted lift flipped from lowest-assistance to highest - reporting the
      // user's worst set as their PR.
      isAssisted: ex.isAssisted ?? false,
      // Coerce any left-empty inputs to 0 on save (they were kept empty during
      // editing so the fields are clearable), preserving each set's field shape.
      setsData: ex.sets.map(set => {
        const isCardio = usesDistance(ex.exerciseType);
        const isHoldType = usesTime(ex.exerciseType) && !isCardio;
        return {
          ...set,
          // Each row keeps the flag it was stored with. Forcing `true` here
          // turned every abandoned prefilled row into a logged set on save, so
          // fixing one typo permanently inflated that workout's sets and volume
          // everywhere - undoing the completed-sets-only correction in the
          // durable store. Rows the user adds in the editor are already created
          // with completed:true (see addSet).
          completed: set.completed ?? false,
          ...(isCardio
            ? { distance: set.distance ?? 0, time: set.time ?? 0 }
            : isHoldType
              // A hold carries a real load and a clock. Writing reps here would
              // store a rep count nobody entered and give it a phantom volume.
              ? { weight: displayToLbs(set.weight, weightUnit) ?? 0, time: set.time ?? 0 }
              : { weight: displayToLbs(set.weight, weightUnit) ?? 0, reps: set.reps ?? 0 }),
        };
      }),
    }));
    
    // Only send a duration when the user actually changed it to something
    // parseable, so an untouched (or unparseable) field never overwrites a
    // good stored value with a guess.
    const parsedDuration = parseDurationInput(editedDuration);
    const durationChanged =
      parsedDuration !== null && parsedDuration !== Math.round(duration ?? 0);

    setIsSaving(true);
    const success = await updateCompletedWorkout(
      workoutId,
      workoutName,
      updatedExercises,
      undefined,
      durationChanged ? parsedDuration : undefined,
    );
    setIsSaving(false);
    
    if (success) {
      setIsEditing(false);
      setEditedExercises([]);
      setEditedDuration("");
      toast({
        title: "Saved",
        description: "Workout updated successfully",
      });
    } else {
      toast({
        title: "Save Failed",
        description: "Failed to save workout changes. Please try again.",
        variant: "destructive",
      });
    }
  };

  const updateSet = (exerciseIdx: number, setIdx: number, field: keyof SetDetail, value: number | undefined) => {
    setEditedExercises(prev => {
      const newExercises = [...prev];
      const exercise = { ...newExercises[exerciseIdx] };
      const sets = [...exercise.sets];
      // Typing a value here IS logging the set. An exercise you opened but
      // never finished keeps its PREFILLED rows (weight and reps already
      // populated, completed:false), so before this an edit to one of those
      // saved silently as still-not-completed: the row vanished from the card
      // again and the workout was unchanged. Ivo hit exactly that going back to
      // finish two exercises an hour later (2026-08-28).
      //
      // Scoped to rows the user actually touches, which is the distinction that
      // matters: blanket-forcing completed on save is what once turned every
      // abandoned prefill into a logged set and inflated the workout.
      sets[setIdx] = { ...sets[setIdx], [field]: value, completed: true };
      exercise.sets = sets;
      newExercises[exerciseIdx] = exercise;
      return newExercises;
    });
  };

  /** Explicit control, so logging a set is never only a side effect of typing. */
  const toggleSetLogged = (exerciseIdx: number, setIdx: number) => {
    setEditedExercises(prev => {
      const newExercises = [...prev];
      const exercise = { ...newExercises[exerciseIdx] };
      const sets = [...exercise.sets];
      sets[setIdx] = { ...sets[setIdx], completed: !sets[setIdx].completed };
      exercise.sets = sets;
      newExercises[exerciseIdx] = exercise;
      return newExercises;
    });
  };

  const addSet = (exerciseIdx: number) => {
    setEditedExercises(prev => {
      const newExercises = [...prev];
      const exercise = { ...newExercises[exerciseIdx] };
      const newSetNumber = exercise.sets.length + 1;
      // Start empty (not 0) so the user can type straight in - a prefilled "0"
      // is annoying to clear on mobile. Empties coerce to 0 on save.
      const newSet: SetDetail = { setNumber: newSetNumber, completed: true };
      exercise.sets = [...exercise.sets, newSet];
      newExercises[exerciseIdx] = exercise;
      return newExercises;
    });
  };

  const removeSet = (exerciseIdx: number, setIdx: number) => {
    setEditedExercises(prev => {
      const newExercises = [...prev];
      const exercise = { ...newExercises[exerciseIdx] };
      // Don't allow removing the last set
      if (exercise.sets.length <= 1) return prev;
      const sets = exercise.sets.filter((_, idx) => idx !== setIdx);
      // Renumber sets
      exercise.sets = sets.map((s, idx) => ({ ...s, setNumber: idx + 1 }));
      newExercises[exerciseIdx] = exercise;
      return newExercises;
    });
  };

  const displayExercises = isEditing ? editedExercises : enrichedExercises;

  return (
    <div className="card-elevated" data-testid={`card-history-${id}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-base font-bold" data-testid={`text-history-name-${id}`}>
              {workoutName}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="font-mono text-[11px] uppercase tracking-[0.06em] text-tertiary-foreground"
                data-testid={`text-history-date-${id}`}
              >
                {format(date, "MMM d")}
              </span>
              <CollapsibleTrigger
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                data-testid={`button-expand-${id}`}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
            </div>
          </div>
          <div className="flex gap-6">
            <div>
              <div className="font-mono text-[17px] font-bold text-primary">{exerciseCount}</div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-tertiary-foreground">
                Exercises
              </div>
            </div>
            <div>
              <div className="font-mono text-[17px] font-bold" data-testid={`text-history-sets-${id}`}>
                {completedSets}
              </div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-tertiary-foreground">
                Sets
              </div>
            </div>
            {totalVolume > 0 && (
              <div>
                <div className="font-mono text-[17px] font-bold" data-testid={`text-history-volume-${id}`}>
                  {Math.round(lbsToDisplay(totalVolume, weightUnit) ?? 0).toLocaleString()}
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-tertiary-foreground">
                  {weightUnit} vol
                </div>
              </div>
            )}
            {duration > 0 && (
              <div>
                <div className="font-mono text-[17px] font-bold" data-testid={`text-history-duration-${id}`}>
                  {formatDuration(duration)}
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-tertiary-foreground">
                  Time
                </div>
              </div>
            )}
          </div>
        </div>
        <CollapsibleContent>
          <div className="border-t border-divider px-4 py-4">
            {isEditing && (
              <div className="flex items-center gap-2 mb-3">
                <label
                  htmlFor={`duration-${id}`}
                  className="font-mono text-[11px] uppercase tracking-wider text-tertiary-foreground"
                >
                  Duration
                </label>
                <Input
                  id={`duration-${id}`}
                  value={editedDuration}
                  onChange={(e) => setEditedDuration(e.target.value)}
                  placeholder="1h 5m"
                  className="h-9 w-28 font-mono"
                  data-testid={`input-duration-${id}`}
                />
                <span className="text-xs text-tertiary-foreground">
                  e.g. 55, 1h 5m, 1:05
                </span>
              </div>
            )}
            <div className="flex justify-end mb-3 gap-2">
              {isEditing ? (
                <>
                  <Button variant="ghost" size="sm" onClick={cancelEditing} data-testid={`button-cancel-edit-${id}`}>
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveEditing} disabled={isSaving} data-testid={`button-save-edit-${id}`}>
                    <Check className="h-4 w-4 mr-1" />
                    {isSaving ? "Saving..." : "Save"}
                  </Button>
                </>
              ) : (
                <>
                  {!calendarEventId && workoutId && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => syncCalendarMutation.mutate()}
                      disabled={syncCalendarMutation.isPending}
                      data-testid={`button-sync-calendar-${id}`}
                    >
                      <RefreshCw className={`h-4 w-4 mr-1 ${syncCalendarMutation.isPending ? 'animate-spin' : ''}`} />
                      {syncCalendarMutation.isPending ? 'Syncing...' : 'Sync to Calendar'}
                    </Button>
                  )}
                  {workoutId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleContinue}
                      data-testid={`button-continue-${id}`}
                    >
                      <Play className="h-4 w-4 mr-1" />
                      Continue
                    </Button>
                  )}
                  {workoutId && (
                    // The summary screen was only ever reachable by the redirect
                    // straight after finishing, so navigating away lost it for
                    // good even though the page loads fine from an id (Ivo,
                    // 2026-08-28: "how does one see the workout summary from the
                    // history of each workout again once it's clicked away").
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/workout-complete/${workoutId}`)}
                      data-testid={`button-summary-${id}`}
                    >
                      <Trophy className="h-4 w-4 mr-1" />
                      Summary
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={startEditing} data-testid={`button-edit-${id}`}>
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit Sets
                  </Button>
                </>
              )}
            </div>
            <div className="space-y-3 sm:space-y-4">
              {displayExercises.map((exercise, exIdx) => {
                // View mode lists exactly what the header counts: COMPLETED sets.
                // It used to include any data-bearing row, so an abandoned
                // prefilled set showed in the list but not in the "N sets" stat
                // beside it. Edit mode still shows every row so nothing is
                // hidden from (or silently dropped by) an edit.
                const completedSets = exercise.sets.filter(s => s.completed);
                if (completedSets.length === 0 && !isEditing) return null;

                const setsToDisplay = isEditing ? exercise.sets : completedSets;
                const isCardioStyle = usesDistance(exercise.exerciseType);
                const isHold = usesTime(exercise.exerciseType) && !isCardioStyle;
                
                return (
                  <div key={exIdx} className="border-l-2 border-primary pl-3 sm:pl-4">
                    <h4 className="font-semibold text-sm sm:text-base mb-1 sm:mb-2">{exercise.name}</h4>
                    <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm text-muted-foreground">
                      {setsToDisplay.map((set, setIdx) => {
                        const originalSetIdx = exercise.sets.findIndex(s => s === set);
                        
                        if (isEditing) {
                          return (
                            <div key={setIdx} className="flex items-center gap-2 flex-wrap">
                              <button
                                type="button"
                                onClick={() => toggleSetLogged(exIdx, originalSetIdx)}
                                aria-label={set.completed ? `Set ${setIdx + 1} logged` : `Set ${setIdx + 1} not logged`}
                                aria-pressed={!!set.completed}
                                title={set.completed ? "Logged. Tap to unlog." : "Not logged. Tap to log."}
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
                                  set.completed
                                    ? "border-yellow bg-primary-dim text-primary"
                                    : "border-strong text-transparent"
                                }`}
                                data-testid={`toggle-set-logged-${id}-${exIdx}-${setIdx}`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <span className={`font-medium w-12 ${set.completed ? "" : "text-tertiary-foreground"}`}>
                                Set {setIdx + 1}:
                              </span>
                              {isHold ? (
                                <>
                                  <Input
                                    type="number"
                                    step={weightUnit === 'kg' ? '0.5' : '1'}
                                    value={set.weight ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'weight', e.target.value === "" ? undefined : parseFloat(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-weight-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>{weightUnit} for</span>
                                  <Input
                                    type="number"
                                    value={set.time ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'time', e.target.value === "" ? undefined : parseInt(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-time-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>sec</span>
                                </>
                              ) : isCardioStyle ? (
                                <>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={set.distance ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'distance', e.target.value === "" ? undefined : parseFloat(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-distance-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>mi in</span>
                                  <Input
                                    type="number"
                                    value={set.time ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'time', e.target.value === "" ? undefined : parseInt(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-time-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>min</span>
                                </>
                              ) : (
                                <>
                                  <Input
                                    type="number"
                                    step={weightUnit === 'kg' ? '0.5' : '1'}
                                    value={set.weight ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'weight', e.target.value === "" ? undefined : parseFloat(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-weight-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>{weightUnit} ×</span>
                                  <Input
                                    type="number"
                                    value={set.reps ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'reps', e.target.value === "" ? undefined : parseInt(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-reps-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>reps</span>
                                </>
                              )}
                              {exercise.sets.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => removeSet(exIdx, originalSetIdx)}
                                  data-testid={`button-remove-set-${id}-${exIdx}-${setIdx}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          );
                        }
                        
                        return (
                          <div key={setIdx} data-testid={`text-set-${id}-${exIdx}-${setIdx}`}>
                            {isHold && set.time ? (
                              `Set ${setIdx + 1}: ${lbsToDisplay(set.weight ?? 0, weightUnit)} ${weightUnit} for ${set.time}s`
                            ) : set.weight != null && set.reps ? (
                              `Set ${setIdx + 1}: ${lbsToDisplay(set.weight, weightUnit)} ${weightUnit} × ${set.reps}`
                            ) : set.distance && set.time ? (
                              `Set ${setIdx + 1}: ${set.distance} mi in ${set.time} min`
                            ) : (
                              `Set ${setIdx + 1}: Completed`
                            )}
                          </div>
                        );
                      })}
                      {isEditing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() => addSet(exIdx)}
                          data-testid={`button-add-set-${id}-${exIdx}`}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add Set
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}