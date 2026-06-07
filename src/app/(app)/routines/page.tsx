"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Plus, Calendar as CalendarIcon, Trash2, Pencil, Play, Globe, Lock, MoreVertical, ChevronLeft, ChevronRight, CheckCircle, X, Copy } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, addDays } from "date-fns";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Routine, RoutineEntry, WorkoutTemplate, RoutineInstance } from "@/lib/db/schema";

interface RoutineWithEntries extends Routine {
  entries: RoutineEntry[];
}

export default function RoutinesPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("my-routines");
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<RoutineWithEntries | null>(null);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [applyingRoutine, setApplyingRoutine] = useState<RoutineWithEntries | null>(null);
  const [applyStartDate, setApplyStartDate] = useState<Date>(new Date());
  const [applyDuration, setApplyDuration] = useState<number>(7);

  const [routineName, setRoutineName] = useState("");
  const [routineDescription, setRoutineDescription] = useState("");
  const [routineDuration, setRoutineDuration] = useState(7);
  const [routineIsPublic, setRoutineIsPublic] = useState(false);
  const [routineEntries, setRoutineEntries] = useState<{ dayIndex: number; workoutTemplateId: string | null; workoutName: string | null; exercises: any[] | null }[]>([]);
  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const [updateActiveRoutineId, setUpdateActiveRoutineId] = useState<string | null>(null);

  const { data: myRoutines = [], isLoading: loadingMine } = useQuery<Routine[]>({
    queryKey: ["/api/routines"],
  });

  const { data: publicRoutines = [], isLoading: loadingPublic } = useQuery<Routine[]>({
    queryKey: ["/api/routines/public"],
  });

  const { data: workoutTemplates = [] } = useQuery<WorkoutTemplate[]>({
    queryKey: ["/api/workout-templates"],
  });

  const { data: activeInstances = [], isLoading: loadingInstances } = useQuery<RoutineInstance[]>({
    queryKey: ["/api/routine-instances/active"],
  });

  const createRoutineMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; defaultDurationDays: number; isPublic: boolean; entries: any[] }) => {
      return apiRequest("POST", "/api/routines", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routines/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates/routine-usage"] });
      toast({ title: "Routine created", description: "Your routine has been saved." });
      closeBuilder();
    },
    onError: (error) => {
      toast({ title: "Failed to create routine", description: describeApiError(error), variant: "destructive" });
    },
  });

  const updateRoutineMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PUT", `/api/routines/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routines/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates/routine-usage"] });
    },
    onError: (error) => {
      toast({ title: "Failed to update routine", description: describeApiError(error), variant: "destructive" });
    },
  });

  const deleteRoutineMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/routines/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routines/public"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates/routine-usage"] });
      toast({ title: "Routine deleted" });
    },
    onError: (error) => {
      toast({ title: "Failed to delete routine", description: describeApiError(error), variant: "destructive" });
    },
  });

  const startRoutineMutation = useMutation({
    mutationFn: async ({ id, startDate, durationDays }: { id: string; startDate: string; durationDays: number }) => {
      const response = await apiRequest("POST", `/api/routines/${id}/start`, { startDate, durationDays });
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routine-instances/active"] });
      toast({ 
        title: "Routine started", 
        description: `${data.createdCount} workouts have been scheduled. Track your progress here!` 
      });
      setIsApplyModalOpen(false);
      setApplyingRoutine(null);
    },
    onError: (error: any) => {
      const message = error?.message || "Failed to start routine";
      toast({ title: "Failed to start routine", description: message, variant: "destructive" });
    },
  });

  const cancelInstanceMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("PATCH", `/api/routine-instances/${id}`, { status: 'cancelled' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routine-instances/active"] });
      toast({ title: "Routine cancelled" });
    },
    onError: (error) => {
      toast({ title: "Failed to cancel routine", description: describeApiError(error), variant: "destructive" });
    },
  });

  const updateActiveInstancesMutation = useMutation({
    mutationFn: async (routineId: string) => {
      const response = await apiRequest("POST", `/api/routines/${routineId}/update-active-instances`);
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/scheduled-workouts"] });
      toast({ 
        title: "Active routines updated", 
        description: `${data.updatedCount} remaining scheduled workouts have been updated.` 
      });
      setUpdateActiveRoutineId(null);
    },
    onError: (error) => {
      toast({ title: "Failed to update active routines", description: describeApiError(error), variant: "destructive" });
      setUpdateActiveRoutineId(null);
    },
  });

  const closeBuilder = () => {
    setIsBuilderOpen(false);
    setEditingRoutine(null);
    setRoutineName("");
    setRoutineDescription("");
    setRoutineDuration(7);
    setRoutineIsPublic(false);
    setRoutineEntries([]);
    setCurrentWeekOffset(0);
  };

  const openNewRoutine = () => {
    setEditingRoutine(null);
    setRoutineName("");
    setRoutineDescription("");
    setRoutineDuration(7);
    setRoutineIsPublic(false);
    setRoutineEntries([]);
    setCurrentWeekOffset(0);
    setIsBuilderOpen(true);
  };

  const openEditRoutine = async (routine: Routine) => {
    try {
      const response = await fetch(`/api/routines/${routine.id}`, { credentials: 'include' });
      const fullRoutine: RoutineWithEntries = await response.json();
      
      setEditingRoutine(fullRoutine);
      setRoutineName(fullRoutine.name);
      setRoutineDescription(fullRoutine.description || "");
      setRoutineDuration(fullRoutine.defaultDurationDays);
      setRoutineIsPublic(fullRoutine.isPublic);
      setRoutineEntries(fullRoutine.entries.map(e => ({
        dayIndex: e.dayIndex,
        workoutTemplateId: e.workoutTemplateId,
        workoutName: e.workoutName,
        exercises: e.exercises as any[] | null,
      })));
      setCurrentWeekOffset(0);
      setIsBuilderOpen(true);
    } catch (error) {
      toast({ title: "Failed to load routine", variant: "destructive" });
    }
  };

  const openApplyRoutine = async (routine: Routine) => {
    try {
      const response = await fetch(`/api/routines/${routine.id}`, { credentials: 'include' });
      const fullRoutine: RoutineWithEntries = await response.json();
      
      setApplyingRoutine(fullRoutine);
      setApplyStartDate(new Date());
      setApplyDuration(fullRoutine.defaultDurationDays);
      setIsApplyModalOpen(true);
    } catch (error) {
      toast({ title: "Failed to load routine", variant: "destructive" });
    }
  };

  const handleSaveRoutine = async () => {
    if (!routineName.trim()) {
      toast({ title: "Please enter a routine name", variant: "destructive" });
      return;
    }

    const data = {
      name: routineName,
      description: routineDescription || undefined,
      defaultDurationDays: routineDuration,
      isPublic: routineIsPublic,
      entries: routineEntries.filter(e => e.workoutName),
    };

    if (editingRoutine) {
      const routineId = editingRoutine.id;
      try {
        await updateRoutineMutation.mutateAsync({ id: routineId, data });
        toast({ title: "Routine updated", description: "Your changes have been saved." });
        closeBuilder();
        
        // Refetch active instances to ensure we have the latest data
        try {
          const result = await queryClient.fetchQuery<RoutineInstance[]>({ 
            queryKey: ["/api/routine-instances/active"],
            staleTime: 0 
          });
          
          // Check if this routine has active instances
          const hasActiveInstance = result.some(i => i.routineId === routineId);
          if (hasActiveInstance) {
            setUpdateActiveRoutineId(routineId);
          }
        } catch (fetchError) {
          console.error("Failed to check for active instances:", fetchError);
        }
      } catch (error) {
        // Error toast is handled by mutation onError
      }
    } else {
      createRoutineMutation.mutate(data);
    }
  };

  const handleStartRoutine = () => {
    if (!applyingRoutine) return;
    
    startRoutineMutation.mutate({
      id: applyingRoutine.id,
      startDate: applyStartDate.toISOString(),
      durationDays: applyDuration,
    });
  };

  const handleDurationChange = (newDuration: number) => {
    setRoutineDuration(newDuration);
    setRoutineEntries(prev => prev.filter(e => e.dayIndex <= newDuration));
  };

  const setDayWorkout = (dayIndex: number, templateId: string | null) => {
    const template = workoutTemplates.find(t => t.id === templateId);
    
    setRoutineEntries(prev => {
      const existing = prev.find(e => e.dayIndex === dayIndex);
      if (templateId === null || templateId === "rest") {
        return prev.filter(e => e.dayIndex !== dayIndex);
      }
      
      const newEntry = {
        dayIndex,
        workoutTemplateId: templateId,
        workoutName: template?.name || null,
        exercises: template?.exercises as any[] | null || null,
      };
      
      if (existing) {
        return prev.map(e => e.dayIndex === dayIndex ? newEntry : e);
      }
      return [...prev, newEntry];
    });
  };

  const getWeekDays = (weekOffset: number) => {
    const startDay = weekOffset * 7 + 1;
    return Array.from({ length: 7 }, (_, i) => startDay + i).filter(d => d <= routineDuration);
  };

  const currentWeekDays = getWeekDays(currentWeekOffset);
  const totalWeeks = Math.ceil(routineDuration / 7);

  const copyWeekToNext = () => {
    const currentWeekStart = currentWeekOffset * 7 + 1;
    const nextWeekStart = (currentWeekOffset + 1) * 7 + 1;
    
    // Get entries for the current week
    const currentWeekEntries = routineEntries.filter(
      e => e.dayIndex >= currentWeekStart && e.dayIndex < currentWeekStart + 7
    );
    
    // Create new entries for the next week (shift day indices by 7)
    const copiedEntries = currentWeekEntries
      .map(entry => ({
        ...entry,
        dayIndex: entry.dayIndex + 7,
      }))
      .filter(e => e.dayIndex <= routineDuration); // Only keep entries within duration
    
    // Remove existing entries for the next week and add copied ones
    setRoutineEntries(prev => {
      const withoutNextWeek = prev.filter(
        e => e.dayIndex < nextWeekStart || e.dayIndex >= nextWeekStart + 7
      );
      return [...withoutNextWeek, ...copiedEntries];
    });
    
    // Navigate to the next week
    setCurrentWeekOffset(currentWeekOffset + 1);
    
    toast({
      title: "Week copied",
      description: `Week ${currentWeekOffset + 1} copied to Week ${currentWeekOffset + 2}`,
    });
  };

  const renderRoutineCard = (routine: Routine, isOwner: boolean) => {
    const entryCount = myRoutines.find(r => r.id === routine.id) ? 
      routineEntries.filter(e => e.workoutName).length : 0;
    
    return (
      <Card key={routine.id} className="hover-elevate" data-testid={`card-routine-${routine.id}`}>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 p-4 sm:p-6 pb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-base sm:text-lg font-semibold truncate">
                {routine.name}
              </CardTitle>
              <Badge variant="outline" className="shrink-0">
                {routine.defaultDurationDays} days
              </Badge>
              {routine.isPublic ? (
                <Badge variant="secondary" className="shrink-0">
                  <Globe className="h-3 w-3 mr-1" />
                  Public
                </Badge>
              ) : (
                <Badge variant="outline" className="shrink-0 text-muted-foreground">
                  <Lock className="h-3 w-3 mr-1" />
                  Private
                </Badge>
              )}
            </div>
            {routine.description && (
              <CardDescription className="mt-1 line-clamp-2">
                {routine.description}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              onClick={() => openApplyRoutine(routine)}
              data-testid={`button-apply-routine-${routine.id}`}
            >
              <Play className="h-4 w-4" />
            </Button>
            {isOwner && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" data-testid={`button-routine-menu-${routine.id}`}>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditRoutine(routine)} data-testid={`button-edit-routine-${routine.id}`}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => deleteRoutineMutation.mutate(routine.id)}
                    className="text-destructive"
                    data-testid={`button-delete-routine-${routine.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 pt-0">
          <p className="text-xs text-muted-foreground">
            Created {format(new Date(routine.createdAt), "PPP")}
          </p>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <div className="container max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Routines</h1>
            <p className="text-muted-foreground">Create and manage your workout routines</p>
          </div>
          <Button onClick={openNewRoutine} data-testid="button-create-routine">
            <Plus className="h-4 w-4 mr-2" />
            Create Routine
          </Button>
        </div>

        {activeInstances.length > 0 && (
          <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20" data-testid="card-active-routines">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Play className="h-5 w-5 text-primary" />
                Active Routines
              </CardTitle>
              <CardDescription>Track your routine progress</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeInstances.map((instance) => {
                const totalDone = instance.completedWorkouts + (instance.skippedWorkouts || 0);
                const progressPercent = instance.totalWorkouts > 0 
                  ? Math.round((totalDone / instance.totalWorkouts) * 100) 
                  : 0;
                const isComplete = totalDone >= instance.totalWorkouts;
                
                return (
                  <div 
                    key={instance.id} 
                    className="p-4 bg-card rounded-lg space-y-3"
                    data-testid={`card-active-routine-${instance.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold truncate">{instance.routineName}</h4>
                          {isComplete && (
                            <Badge variant="secondary" className="text-primary shrink-0">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Complete
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(instance.startDate), "MMM d")} - {format(new Date(instance.endDate), "MMM d, yyyy")}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 h-8 w-8"
                        onClick={() => cancelInstanceMutation.mutate(instance.id)}
                        data-testid={`button-cancel-instance-${instance.id}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span>
                          {instance.completedWorkouts} completed
                          {(instance.skippedWorkouts || 0) > 0 && (
                            <span className="text-muted-foreground"> + {instance.skippedWorkouts} skipped</span>
                          )}
                          {" "}of {instance.totalWorkouts}
                        </span>
                        <span className="font-medium text-primary">{progressPercent}%</span>
                      </div>
                      <Progress value={progressPercent} className="h-2" />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="my-routines" data-testid="tab-my-routines">My Routines</TabsTrigger>
            <TabsTrigger value="public-library" data-testid="tab-public-library">Public Library</TabsTrigger>
          </TabsList>

          <TabsContent value="my-routines" className="mt-6">
            {loadingMine ? (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                {[1, 2, 3].map(i => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-48" />
                      <Skeleton className="h-4 w-32 mt-2" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : myRoutines.length === 0 ? (
              <Card className="p-8 sm:p-12 text-center">
                <div className="text-muted-foreground">
                  <CalendarIcon className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 opacity-50" />
                  <h3 className="text-base sm:text-lg font-semibold mb-2">No routines yet</h3>
                  <p className="text-sm mb-4">Create your first routine to get started.</p>
                  <Button onClick={openNewRoutine} data-testid="button-create-first-routine">
                    <Plus className="h-4 w-4 mr-2" />
                    Create Routine
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                {myRoutines.map(routine => renderRoutineCard(routine, true))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="public-library" className="mt-6">
            {loadingPublic ? (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                {[1, 2, 3].map(i => (
                  <Card key={i}>
                    <CardHeader>
                      <Skeleton className="h-6 w-48" />
                      <Skeleton className="h-4 w-32 mt-2" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : publicRoutines.length === 0 ? (
              <Card className="p-8 sm:p-12 text-center">
                <div className="text-muted-foreground">
                  <Globe className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-4 opacity-50" />
                  <h3 className="text-base sm:text-lg font-semibold mb-2">No public routines</h3>
                  <p className="text-sm">Be the first to share a routine with the community!</p>
                </div>
              </Card>
            ) : (
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                {publicRoutines.map(routine => renderRoutineCard(routine, false))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={isBuilderOpen} onOpenChange={(open) => !open && closeBuilder()}>
          <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" data-testid="dialog-routine-builder">
            <DialogHeader>
              <DialogTitle>{editingRoutine ? "Edit Routine" : "Create Routine"}</DialogTitle>
              <DialogDescription>
                Build your routine by assigning workouts to each day.
              </DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="flex-1 min-h-0 overflow-auto pr-4">
              <div className="space-y-6 py-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="routine-name">Routine Name</Label>
                    <Input
                      id="routine-name"
                      value={routineName}
                      onChange={(e) => setRoutineName(e.target.value)}
                      placeholder="e.g., 12-Week Strength Program"
                      data-testid="input-routine-name"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="routine-description">Description (optional)</Label>
                    <Textarea
                      id="routine-description"
                      value={routineDescription}
                      onChange={(e) => setRoutineDescription(e.target.value)}
                      placeholder="Describe your routine..."
                      rows={2}
                      data-testid="input-routine-description"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="space-y-2 flex-1">
                      <Label htmlFor="routine-duration">Duration (days)</Label>
                      <Select
                        value={routineDuration.toString()}
                        onValueChange={(v) => v && handleDurationChange(parseInt(v))}
                      >
                        <SelectTrigger data-testid="select-routine-duration">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="7">7 days (1 week)</SelectItem>
                          <SelectItem value="14">14 days (2 weeks)</SelectItem>
                          <SelectItem value="21">21 days (3 weeks)</SelectItem>
                          <SelectItem value="28">28 days (4 weeks)</SelectItem>
                          <SelectItem value="30">30 days</SelectItem>
                          <SelectItem value="60">60 days</SelectItem>
                          <SelectItem value="90">90 days</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center space-x-2 pt-6">
                      <Switch
                        id="routine-public"
                        checked={routineIsPublic}
                        onCheckedChange={setRoutineIsPublic}
                        data-testid="switch-routine-public"
                      />
                      <Label htmlFor="routine-public" className="flex items-center gap-2">
                        {routineIsPublic ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                        {routineIsPublic ? "Public" : "Private"}
                      </Label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Weekly Schedule</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentWeekOffset(Math.max(0, currentWeekOffset - 1))}
                        disabled={currentWeekOffset === 0}
                        data-testid="button-prev-week"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground min-w-[100px] text-center">
                        Week {currentWeekOffset + 1} of {totalWeeks}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentWeekOffset(Math.min(totalWeeks - 1, currentWeekOffset + 1))}
                        disabled={currentWeekOffset >= totalWeeks - 1}
                        data-testid="button-next-week"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {totalWeeks > 1 && currentWeekOffset < totalWeeks - 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyWeekToNext}
                      className="w-full"
                      data-testid="button-copy-week"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Week {currentWeekOffset + 1} to Week {currentWeekOffset + 2}
                    </Button>
                  )}

                  <div className="space-y-2">
                    {currentWeekDays.map(dayIndex => {
                      const entry = routineEntries.find(e => e.dayIndex === dayIndex);
                      return (
                        <div key={dayIndex} className="flex items-center gap-3 p-3 bg-accent/50 rounded-lg">
                          <span className="text-sm font-medium w-16 shrink-0">Day {dayIndex}</span>
                          <Select
                            value={entry?.workoutTemplateId || "rest"}
                            onValueChange={(v) => setDayWorkout(dayIndex, v === "rest" ? null : v)}
                          >
                            <SelectTrigger className="flex-1" data-testid={`select-day-${dayIndex}-workout`}>
                              <SelectValue placeholder="Rest day" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="rest">Rest day</SelectItem>
                              {workoutTemplates.map(template => (
                                <SelectItem key={template.id} value={template.id}>
                                  {template.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </ScrollArea>

            <DialogFooter className="pt-4 border-t">
              <Button variant="outline" onClick={closeBuilder} data-testid="button-cancel-routine">
                Cancel
              </Button>
              <Button 
                onClick={handleSaveRoutine} 
                disabled={createRoutineMutation.isPending || updateRoutineMutation.isPending}
                data-testid="button-save-routine"
              >
                {editingRoutine ? "Save Changes" : "Create Routine"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={isApplyModalOpen} onOpenChange={(open) => { if (!open) { setIsApplyModalOpen(false); setApplyingRoutine(null); } }}>
          <DialogContent data-testid="dialog-apply-routine">
            <DialogHeader>
              <DialogTitle>Start Routine</DialogTitle>
              <DialogDescription>
                Start "{applyingRoutine?.name}" and track your progress.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="button-apply-start-date">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(applyStartDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={applyStartDate}
                      onSelect={(date) => date && setApplyStartDate(date)}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Duration</Label>
                <Select
                  value={applyDuration.toString()}
                  onValueChange={(v) => v && setApplyDuration(parseInt(v))}
                >
                  <SelectTrigger data-testid="select-apply-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: applyingRoutine?.defaultDurationDays || 7 }, (_, i) => i + 1)
                      .filter(d => d === 7 || d === 14 || d === 21 || d === 28 || d === 30 || d === 60 || d === 90 || d === applyingRoutine?.defaultDurationDays)
                      .map(days => (
                        <SelectItem key={days} value={days.toString()}>
                          {days} days {days === applyingRoutine?.defaultDurationDays ? "(full routine)" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This routine has {applyingRoutine?.defaultDurationDays} days. You can apply fewer days if needed.
                </p>
              </div>

              <div className="bg-accent/50 rounded-lg p-3">
                <p className="text-sm">
                  Workouts will be scheduled from <strong>{format(applyStartDate, "PPP")}</strong> to{" "}
                  <strong>{format(addDays(applyStartDate, applyDuration - 1), "PPP")}</strong>.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsApplyModalOpen(false); setApplyingRoutine(null); }} data-testid="button-cancel-apply">
                Cancel
              </Button>
              <Button 
                onClick={handleStartRoutine} 
                disabled={startRoutineMutation.isPending}
                data-testid="button-confirm-apply"
              >
                {startRoutineMutation.isPending ? "Starting..." : "Start Routine"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!updateActiveRoutineId} onOpenChange={(open) => { if (!open) setUpdateActiveRoutineId(null); }}>
          <DialogContent data-testid="dialog-update-active-instances">
            <DialogHeader>
              <DialogTitle>Update Active Routine?</DialogTitle>
              <DialogDescription>
                This routine is currently in progress. Would you like to update the remaining scheduled workouts with the new changes?
              </DialogDescription>
            </DialogHeader>
            
            <p className="text-sm text-muted-foreground py-2">
              Only future workouts that haven't been completed yet will be updated. Past and completed workouts will remain unchanged.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => setUpdateActiveRoutineId(null)} data-testid="button-skip-update-active">
                Skip
              </Button>
              <Button 
                onClick={() => updateActiveRoutineId && updateActiveInstancesMutation.mutate(updateActiveRoutineId)} 
                disabled={updateActiveInstancesMutation.isPending}
                data-testid="button-confirm-update-active"
              >
                {updateActiveInstancesMutation.isPending ? "Updating..." : "Update Future Workouts"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}