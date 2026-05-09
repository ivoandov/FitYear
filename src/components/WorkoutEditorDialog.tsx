"use client";

import { useState, useEffect, type DragEvent } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Plus, X, GripVertical, ChevronUp, ChevronDown, Calendar as CalendarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Exercise } from "@/data/exercises";

export interface WorkoutData {
  id?: string;
  name: string;
  date: Date;
  repeatType: "none" | "daily" | "weekly" | "custom";
  repeatInterval?: number;
  exercises: Exercise[];
}

interface WorkoutEditorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: WorkoutData) => void;
  initialData?: WorkoutData | null;
  availableExercises: Exercise[];
}

export function WorkoutEditorDialog({
  isOpen,
  onClose,
  onSave,
  initialData,
  availableExercises,
}: WorkoutEditorDialogProps) {
  const [workoutName, setWorkoutName] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [repeatType, setRepeatType] = useState<"none" | "daily" | "weekly" | "custom">("none");
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [selectedExercises, setSelectedExercises] = useState<Exercise[]>([]);
  const [activeTab, setActiveTab] = useState("details");
  const [showCalendar, setShowCalendar] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedMuscleFilters, setSelectedMuscleFilters] = useState<string[]>([]);

  const allMuscleGroups = [...new Set(
    availableExercises.flatMap(e => e.muscleGroups || [])
  )].sort();

  const toggleMuscleFilter = (muscle: string) => {
    setSelectedMuscleFilters(prev =>
      prev.includes(muscle)
        ? prev.filter(m => m !== muscle)
        : [...prev, muscle]
    );
  };

  const filteredExercises = selectedMuscleFilters.length === 0
    ? availableExercises
    : availableExercises.filter(e =>
        e.muscleGroups?.some(mg => selectedMuscleFilters.includes(mg))
      );

  useEffect(() => {
    if (initialData) {
      setWorkoutName(initialData.name);
      setDate(initialData.date);
      setRepeatType(initialData.repeatType);
      setRepeatInterval(initialData.repeatInterval || 1);
      setSelectedExercises(initialData.exercises || []);
    } else {
      setWorkoutName("");
      setDate(new Date());
      setRepeatType("none");
      setRepeatInterval(1);
      setSelectedExercises([]);
    }
    setActiveTab("details");
    setShowCalendar(false);
    setSelectedMuscleFilters([]);
  }, [initialData, isOpen]);

  const handleSave = () => {
    onSave({
      id: initialData?.id,
      name: workoutName,
      date,
      repeatType,
      repeatInterval: repeatType === "custom" ? repeatInterval : undefined,
      exercises: selectedExercises,
    });
    onClose();
  };

  const handleAddExercise = (exercise: Exercise) => {
    if (!selectedExercises.find(e => e.id === exercise.id)) {
      setSelectedExercises([...selectedExercises, exercise]);
    }
  };

  const handleRemoveExercise = (exerciseId: string) => {
    setSelectedExercises(selectedExercises.filter(e => e.id !== exerciseId));
  };

  const handleMoveExercise = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= selectedExercises.length) return;
    
    const newExercises = [...selectedExercises];
    [newExercises[index], newExercises[newIndex]] = [newExercises[newIndex], newExercises[index]];
    setSelectedExercises(newExercises);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (draggedIndex !== null && index !== draggedIndex) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newExercises = [...selectedExercises];
    const [draggedItem] = newExercises.splice(draggedIndex, 1);
    newExercises.splice(dropIndex, 0, draggedItem);
    setSelectedExercises(newExercises);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const isEditing = !!initialData?.id;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] sm:max-w-[600px] max-h-[90vh] flex flex-col" data-testid="dialog-workout-editor">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl" data-testid="text-dialog-title">
            {isEditing ? "Edit Workout" : "Create Workout"}
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            {isEditing ? "Modify your workout details and exercises" : "Set up a new workout with exercises"}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
            <TabsTrigger value="exercises" data-testid="tab-exercises">
              Exercises ({selectedExercises.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="flex-1 overflow-y-auto mt-4">
            <div className="space-y-4 sm:space-y-6">
              <div className="space-y-2">
                <Label htmlFor="workout-name" className="text-sm">Workout Name</Label>
                <Input
                  id="workout-name"
                  placeholder="e.g., Upper Body Strength"
                  value={workoutName}
                  onChange={(e) => setWorkoutName(e.target.value)}
                  data-testid="input-workout-name"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Start Date</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 border rounded-md text-sm">
                    {format(date, "PPP")}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowCalendar(!showCalendar)}
                    data-testid="button-toggle-calendar"
                  >
                    <CalendarIcon className="h-4 w-4" />
                  </Button>
                </div>
                {showCalendar && (
                  <div className="flex justify-center overflow-x-auto mt-2">
                    <Calendar
                      mode="single"
                      selected={date}
                      onSelect={(newDate) => {
                        if (newDate) {
                          setDate(newDate);
                          setShowCalendar(false);
                        }
                      }}
                      className="rounded-md border"
                      data-testid="calendar-start-date"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="repeat-type" className="text-sm">Repeat</Label>
                <Select
                  value={repeatType}
                  onValueChange={(value) => {
                    if (value) setRepeatType(value as "none" | "daily" | "weekly" | "custom");
                  }}
                >
                  <SelectTrigger id="repeat-type" data-testid="select-repeat-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Does not repeat</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="custom">Every N days</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {repeatType === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="repeat-interval" className="text-sm">Repeat every</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="repeat-interval"
                      type="number"
                      min="1"
                      value={repeatInterval}
                      onChange={(e) => setRepeatInterval(parseInt(e.target.value) || 1)}
                      className="w-20 sm:w-24"
                      data-testid="input-repeat-interval"
                    />
                    <span className="text-xs sm:text-sm text-muted-foreground">days</span>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="exercises" className="flex-1 overflow-y-auto mt-4">
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label className="text-sm">Selected Exercises</Label>
                {selectedExercises.length === 0 ? (
                  <div className="text-center py-6 text-sm text-muted-foreground border rounded-md">
                    No exercises added yet. Select from below.
                  </div>
                ) : (
                  <div className="border rounded-md">
                    <div className="p-2 space-y-1">
                      {selectedExercises.map((exercise, index) => (
                        <div
                          key={exercise.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, index)}
                          onDragOver={(e) => handleDragOver(e, index)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, index)}
                          onDragEnd={handleDragEnd}
                          className={`flex items-center gap-2 p-2 bg-accent rounded-md transition-all ${
                            draggedIndex === index ? "opacity-50" : ""
                          } ${
                            dragOverIndex === index ? "ring-2 ring-primary ring-offset-1" : ""
                          }`}
                          data-testid={`selected-exercise-${exercise.id}`}
                        >
                          <GripVertical className="h-4 w-4 text-muted-foreground flex-shrink-0 cursor-grab active:cursor-grabbing" />
                          <span className="flex-1 text-sm truncate">{exercise.name}</span>
                          <Badge variant="outline" className="text-xs hidden sm:flex">
                            {exercise.muscleGroups[0] || ""}
                          </Badge>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleMoveExercise(index, "up")}
                              disabled={index === 0}
                              data-testid={`button-move-up-${exercise.id}`}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleMoveExercise(index, "down")}
                              disabled={index === selectedExercises.length - 1}
                              data-testid={`button-move-down-${exercise.id}`}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => handleRemoveExercise(exercise.id)}
                              data-testid={`button-remove-${exercise.id}`}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Available Exercises ({filteredExercises.length})</Label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {allMuscleGroups.map((muscle) => (
                    <Badge
                      key={muscle}
                      variant={selectedMuscleFilters.includes(muscle) ? "default" : "outline"}
                      className="cursor-pointer text-xs toggle-elevate"
                      onClick={() => toggleMuscleFilter(muscle)}
                      data-testid={`filter-muscle-${muscle.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {muscle}
                    </Badge>
                  ))}
                  {selectedMuscleFilters.length > 0 && (
                    <Badge
                      variant="ghost"
                      className="cursor-pointer text-xs text-muted-foreground"
                      onClick={() => setSelectedMuscleFilters([])}
                      data-testid="button-clear-filters"
                    >
                      Clear all
                    </Badge>
                  )}
                </div>
                <div className="border rounded-md">
                  <div className="p-2 space-y-1">
                    {[...filteredExercises]
                      .sort((a, b) => {
                        const muscleA = (a.muscleGroups[0] || "").toLowerCase();
                        const muscleB = (b.muscleGroups[0] || "").toLowerCase();
                        if (muscleA !== muscleB) return muscleA.localeCompare(muscleB);
                        return a.name.localeCompare(b.name);
                      })
                      .map((exercise) => {
                      const isSelected = selectedExercises.some(e => e.id === exercise.id);
                      return (
                        <div
                          key={exercise.id}
                          className={`flex items-center gap-2 p-2 rounded-md ${
                            isSelected ? 'opacity-50' : 'hover-elevate cursor-pointer'
                          }`}
                          onClick={() => !isSelected && handleAddExercise(exercise)}
                          data-testid={`available-exercise-${exercise.id}`}
                        >
                          <span className="flex-1 text-sm truncate">{exercise.name}</span>
                          <Badge variant="outline" className="text-xs">
                            {exercise.muscleGroups[0] || ""}
                          </Badge>
                          {!isSelected && (
                            <Plus className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="rounded-md bg-muted p-3 sm:p-4 mt-4">
          <p className="text-xs sm:text-sm font-medium mb-1">Summary</p>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {workoutName || "Workout"} on {format(date, "PP")}
            {repeatType === "daily" && ", repeating daily"}
            {repeatType === "weekly" && ", repeating weekly"}
            {repeatType === "custom" && `, every ${repeatInterval} days`}
            {" • "}{selectedExercises.length} exercises
          </p>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row gap-2 sm:gap-0 mt-4">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto" data-testid="button-cancel">
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={handleSave}
            disabled={!workoutName || selectedExercises.length === 0}
            className="w-full sm:w-auto"
            data-testid="button-save"
          >
            {isEditing ? "Save Changes" : "Create Workout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}