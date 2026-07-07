"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Dumbbell, TrendingUp, Pencil, Check, X, Plus, Trash2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";
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
  exerciseCount,
  totalVolume,
  totalSets = 0,
  exercises = [],
  calendarEventId,
}: WorkoutHistoryCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedExercises, setEditedExercises] = useState<ExerciseDetail[]>([]);
  const { updateCompletedWorkout } = useWorkout();
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

  const startEditing = () => {
    // Convert stored lbs → display unit when pre-filling edit inputs so the
    // numbers the user sees match the unit label they see.
    setEditedExercises(enrichedExercises.map(ex => {
      const sets = ex.sets.length > 0
        ? ex.sets.map(s => ({ ...s, weight: lbsToDisplay(s.weight, weightUnit) }))
        : [{ setNumber: 1, weight: 0, reps: 0, completed: true }];
      return {
        ...ex,
        sets,
      };
    }));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditedExercises([]);
  };

  const [isSaving, setIsSaving] = useState(false);

  const saveEditing = async () => {
    if (!workoutId) return;
    
    // Convert display-unit weights back to lbs before persisting (DB always stores lbs).
    // Ensure all sets are marked as completed when saving a completed workout edit.
    const updatedExercises = editedExercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      muscleGroups: ex.muscleGroups || [],
      exerciseType: ex.exerciseType || 'weight_reps',
      setsData: ex.sets.map(set => ({
        ...set,
        weight: displayToLbs(set.weight, weightUnit),
        completed: true,
      })),
    }));
    
    setIsSaving(true);
    const success = await updateCompletedWorkout(workoutId, workoutName, updatedExercises);
    setIsSaving(false);
    
    if (success) {
      setIsEditing(false);
      setEditedExercises([]);
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

  const updateSet = (exerciseIdx: number, setIdx: number, field: keyof SetDetail, value: number) => {
    setEditedExercises(prev => {
      const newExercises = [...prev];
      const exercise = { ...newExercises[exerciseIdx] };
      const sets = [...exercise.sets];
      sets[setIdx] = { ...sets[setIdx], [field]: value };
      exercise.sets = sets;
      newExercises[exerciseIdx] = exercise;
      return newExercises;
    });
  };

  const addSet = (exerciseIdx: number) => {
    setEditedExercises(prev => {
      const newExercises = [...prev];
      const exercise = { ...newExercises[exerciseIdx] };
      const isCardioStyle = exercise.exerciseType === 'distance_time';
      const newSetNumber = exercise.sets.length + 1;
      const newSet: SetDetail = isCardioStyle
        ? { setNumber: newSetNumber, distance: 0, time: 0, completed: true }
        : { setNumber: newSetNumber, weight: 0, reps: 0, completed: true };
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
    <Card data-testid={`card-history-${id}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base sm:text-lg font-semibold mb-2 truncate" data-testid={`text-history-name-${id}`}>
                {workoutName}
              </CardTitle>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span data-testid={`text-history-date-${id}`}>{format(date, "PP")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Dumbbell className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span data-testid={`text-history-sets-${id}`}>{completedSets} sets</span>
                </div>
                {totalVolume > 0 && (
                  <div className="flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                    <span data-testid={`text-history-volume-${id}`}>{Math.round(lbsToDisplay(totalVolume, weightUnit) ?? 0).toLocaleString()} {weightUnit}</span>
                  </div>
                )}
              </div>
            </div>
            <CollapsibleTrigger
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
              data-testid={`button-expand-${id}`}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="p-5 sm:p-7 pt-0">
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
                  <Button variant="ghost" size="sm" onClick={startEditing} data-testid={`button-edit-${id}`}>
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit Sets
                  </Button>
                </>
              )}
            </div>
            <div className="space-y-3 sm:space-y-4">
              {displayExercises.map((exercise, exIdx) => {
                // For completed workouts, show all sets (they're all considered completed)
                // In edit mode, show all sets for editing
                // In view mode, show all sets with data (weight/reps or distance/time)
                const setsWithData = exercise.sets.filter(s => 
                  (s.weight != null && s.reps) || (s.distance && s.time) || s.completed
                );
                if (setsWithData.length === 0 && !isEditing) return null;
                
                const setsToDisplay = isEditing ? exercise.sets : setsWithData;
                const isCardioStyle = exercise.exerciseType === 'distance_time';
                
                return (
                  <div key={exIdx} className="border-l-2 border-primary pl-3 sm:pl-4">
                    <h4 className="font-semibold text-sm sm:text-base mb-1 sm:mb-2">{exercise.name}</h4>
                    <div className="space-y-1.5 sm:space-y-2 text-xs sm:text-sm text-muted-foreground">
                      {setsToDisplay.map((set, setIdx) => {
                        const originalSetIdx = exercise.sets.findIndex(s => s === set);
                        
                        if (isEditing) {
                          return (
                            <div key={setIdx} className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium w-12">Set {setIdx + 1}:</span>
                              {isCardioStyle ? (
                                <>
                                  <Input
                                    type="number"
                                    step="0.1"
                                    value={set.distance ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'distance', e.target.value === "" ? 0 : parseFloat(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-distance-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>mi in</span>
                                  <Input
                                    type="number"
                                    value={set.time ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'time', e.target.value === "" ? 0 : parseInt(e.target.value))}
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
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'weight', e.target.value === "" ? 0 : parseFloat(e.target.value))}
                                    className="w-16 h-8 text-center"
                                    data-testid={`input-weight-${id}-${exIdx}-${setIdx}`}
                                  />
                                  <span>{weightUnit} ×</span>
                                  <Input
                                    type="number"
                                    value={set.reps ?? ""}
                                    onChange={(e) => updateSet(exIdx, originalSetIdx, 'reps', e.target.value === "" ? 0 : parseInt(e.target.value))}
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
                            {set.weight != null && set.reps ? (
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
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}