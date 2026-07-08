"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Plus, Calendar as CalendarIcon, Trash2, Pencil, Play, Globe, Lock, MoreVertical, ChevronLeft, ChevronRight, CheckCircle, X, Copy, Sparkles } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, addDays } from "date-fns";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Routine, RoutineEntry, WorkoutTemplate, RoutineInstance } from "@/lib/db/schema";

interface RoutineWithEntries extends Routine {
  entries: RoutineEntry[];
}

// The refresh's neon primary CTA (same gradient treatment as the FitBot flows),
// dialog-scale. Black text, weight 700, raised touch target + brand glow.
const CTA_DIALOG =
  "flex h-12 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] px-6 text-sm font-bold text-primary-foreground shadow-cta disabled:opacity-60";
const BTN_SECONDARY =
  "flex h-12 items-center justify-center rounded-xl border-strong bg-white/[0.03] px-5 text-sm font-semibold text-muted-foreground hover:text-foreground";
const LABEL_EYEBROW =
  "font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-tertiary-foreground";
const CHIP =
  "inline-flex items-center gap-1 rounded-md border bg-white/[0.05] px-1.5 py-1 font-mono text-[10px] tracking-[0.06em]";

// A mono weeks/days chip for routine duration.
function durationLabel(days: number): string {
  return days % 7 === 0 ? `${days / 7} WK` : `${days} D`;
}

// A routine is FitBot-built when its description carries the marker save-program
// writes ("Built by Fit Bot · …"). Drives the neon ✦ FITBOT badge (the routines
// table has no dedicated source column, and this signal is authoritative because
// only the AI builder writes that prefix).
function isFitBotRoutine(routine: Routine): boolean {
  return /^Built by Fit Bot/i.test(routine.description ?? "");
}

// Which weekday slots (0=Mon … 6=Sun) have a workout scheduled, for the little
// M–S week-schedule strip. Derived from the routine's `entries`, which the list
// endpoint (GET /api/routines) now includes as a compact projection.
const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
function weekdayFlags(routine: Routine): boolean[] | null {
  const entries = (routine as Routine & { entries?: RoutineEntry[] }).entries;
  if (!entries || !Array.isArray(entries) || entries.length === 0) return null;
  const flags = Array(7).fill(false) as boolean[];
  for (const e of entries) {
    if (e.workoutName || e.workoutTemplateId) {
      flags[(((e.dayIndex - 1) % 7) + 7) % 7] = true;
    }
  }
  return flags;
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

  const { data: activeInstances = [] } = useQuery<RoutineInstance[]>({
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
    const flags = weekdayFlags(routine);

    return (
      <div key={routine.id} className="card-elevated p-4" data-testid={`card-routine-${routine.id}`}>
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-bold text-foreground">{routine.name}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {isFitBotRoutine(routine) && (
                <span className="inline-flex items-center gap-1 rounded-md border border-yellow bg-primary-dim px-1.5 py-1 font-mono text-[10px] font-bold tracking-[0.06em] text-primary">
                  <Sparkles className="h-2.5 w-2.5" /> FITBOT
                </span>
              )}
              <span className={`${CHIP} text-muted-foreground`}>{durationLabel(routine.defaultDurationDays)}</span>
              {routine.isPublic ? (
                <span className={`${CHIP} text-muted-foreground`}>
                  <Globe className="h-2.5 w-2.5" /> PUBLIC
                </span>
              ) : (
                <span className={`${CHIP} text-tertiary-foreground`}>
                  <Lock className="h-2.5 w-2.5" /> PRIVATE
                </span>
              )}
            </div>
          </div>
          {isOwner && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Routine menu"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground hover:text-foreground"
                  data-testid={`button-routine-menu-${routine.id}`}
                >
                  <MoreVertical className="h-[18px] w-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditRoutine(routine)} data-testid={`button-edit-routine-${routine.id}`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => deleteRoutineMutation.mutate(routine.id)}
                  className="text-destructive"
                  data-testid={`button-delete-routine-${routine.id}`}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {routine.description && (
          <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-tertiary-foreground">
            {routine.description}
          </p>
        )}

        <div className="mt-3.5 flex items-center justify-between gap-3">
          {flags ? (
            <div className="flex gap-1.5">
              {flags.map((on, i) => (
                <div
                  key={i}
                  className={`flex h-[22px] w-[22px] items-center justify-center rounded-md font-mono text-[9px] ${
                    on ? "bg-primary font-bold text-primary-foreground" : "bg-white/[0.05] text-tertiary-foreground"
                  }`}
                >
                  {WEEKDAY_LETTERS[i]}
                </div>
              ))}
            </div>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-tertiary-foreground">
              Created {format(new Date(routine.createdAt), "MMM d, yyyy")}
            </span>
          )}
          <button
            type="button"
            onClick={() => openApplyRoutine(routine)}
            aria-label="Start routine"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-cta"
            data-testid={`button-apply-routine-${routine.id}`}
          >
            <Play className="h-[18px] w-[18px] fill-current" />
          </button>
        </div>
      </div>
    );
  };

  const renderRoutineGrid = (routines: Routine[], isOwner: boolean, loading: boolean, empty: ReactNode) => {
    if (loading) {
      return (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="card-elevated p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="mt-3 h-4 w-24" />
            </div>
          ))}
        </div>
      );
    }
    if (routines.length === 0) return empty;
    return (
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {routines.map(routine => renderRoutineCard(routine, isOwner))}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">Routines</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your programs &amp; library</p>
          </div>
          <button
            type="button"
            onClick={openNewRoutine}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-cta"
            data-testid="button-create-routine"
          >
            <Plus className="h-4 w-4" strokeWidth={2.4} />
            Create
          </button>
        </div>

        {/* Active program cards */}
        {activeInstances.length > 0 && (
          <div className="space-y-3" data-testid="card-active-routines">
            {activeInstances.map((instance) => {
              const totalDone = instance.completedWorkouts + (instance.skippedWorkouts || 0);
              const progressPercent = instance.totalWorkouts > 0
                ? Math.round((totalDone / instance.totalWorkouts) * 100)
                : 0;
              const isComplete = totalDone >= instance.totalWorkouts;
              const dateRange = `${format(new Date(instance.startDate), "MMM d")} - ${format(new Date(instance.endDate), "MMM d, yyyy")}`.toUpperCase();

              return (
                <div
                  key={instance.id}
                  className="rounded-[18px] border-[1.5px] border-yellow bg-[radial-gradient(120%_100%_at_0%_0%,rgba(229,255,0,0.12),rgba(229,255,0,0.03))] p-[18px]"
                  data-testid={`card-active-routine-${instance.id}`}
                >
                  <div className="mb-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-primary">
                      <Play className="h-3 w-3 fill-current" />
                      Active Program
                    </div>
                    <button
                      type="button"
                      onClick={() => cancelInstanceMutation.mutate(instance.id)}
                      aria-label="Cancel routine"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-tertiary-foreground hover:text-foreground"
                      data-testid={`button-cancel-instance-${instance.id}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="truncate text-[18px] font-bold text-foreground">{instance.routineName}</div>
                    {isComplete && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-primary-foreground">
                        <CheckCircle className="h-3 w-3" />
                        Complete
                      </span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-[11px] tracking-[0.04em] text-muted-foreground">
                    {dateRange}
                  </div>

                  <div className="mb-2 mt-3.5 flex items-center justify-between">
                    <span className="whitespace-nowrap font-mono text-[13px] text-foreground">
                      <span className="font-bold">{totalDone}</span>{" "}
                      <span className="text-tertiary-foreground">/ {instance.totalWorkouts} workouts</span>
                    </span>
                    <span className="font-mono text-[13px] font-bold text-primary">{progressPercent}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#E5FF00,#c9e000)] shadow-[0_0_10px_rgba(229,255,0,0.5)]"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Segmented tabs */}
        <div className="flex gap-1 rounded-xl border bg-[#141412] p-[3px]">
          {([["my-routines", "My Routines"], ["public-library", "Public Library"]] as const).map(([value, label]) => {
            const active = activeTab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value)}
                data-testid={value === "my-routines" ? "tab-my-routines" : "tab-public-library"}
                className={`flex-1 rounded-[9px] border py-2 text-center text-[13px] font-semibold transition-colors ${
                  active
                    ? "border-strong bg-white/[0.08] text-foreground"
                    : "border-transparent text-tertiary-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {activeTab === "my-routines"
          ? renderRoutineGrid(
              myRoutines,
              true,
              loadingMine,
              <div className="card-elevated flex flex-col items-center p-10 text-center">
                <CalendarIcon className="mb-4 h-10 w-10 text-tertiary-foreground" />
                <h3 className="text-base font-bold">No routines yet</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">Create your first routine to get started.</p>
                <button type="button" onClick={openNewRoutine} className={`${CTA_DIALOG} mt-5`} data-testid="button-create-first-routine">
                  <Plus className="h-4 w-4" strokeWidth={2.4} />
                  Create Routine
                </button>
              </div>,
            )
          : renderRoutineGrid(
              publicRoutines,
              false,
              loadingPublic,
              <div className="card-elevated flex flex-col items-center p-10 text-center">
                <Globe className="mb-4 h-10 w-10 text-tertiary-foreground" />
                <h3 className="text-base font-bold">No public routines</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">Be the first to share a routine with the community!</p>
              </div>,
            )}

        {/* Routine builder */}
        <Dialog open={isBuilderOpen} onOpenChange={(open) => !open && closeBuilder()}>
          <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col" data-testid="dialog-routine-builder">
            <DialogHeader>
              <DialogTitle>{editingRoutine ? "Edit Routine" : "Create Routine"}</DialogTitle>
              <DialogDescription>
                Build your routine by assigning workouts to each day.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="min-h-0 flex-1 overflow-auto pr-4">
              <div className="space-y-6 py-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="routine-name" className={LABEL_EYEBROW}>Routine Name</Label>
                    <Input
                      id="routine-name"
                      value={routineName}
                      onChange={(e) => setRoutineName(e.target.value)}
                      placeholder="e.g., 12-Week Strength Program"
                      data-testid="input-routine-name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="routine-description" className={LABEL_EYEBROW}>Description (optional)</Label>
                    <Textarea
                      id="routine-description"
                      value={routineDescription}
                      onChange={(e) => setRoutineDescription(e.target.value)}
                      placeholder="Describe your routine..."
                      rows={2}
                      className="min-h-[64px]"
                      data-testid="input-routine-description"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="routine-duration" className={LABEL_EYEBROW}>Duration</Label>
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

                  <div className="flex h-12 items-center justify-between rounded-[10px] border bg-white/[0.03] px-3.5">
                    <Label htmlFor="routine-public" className={`${LABEL_EYEBROW} flex items-center gap-2`}>
                      {routineIsPublic ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                      {routineIsPublic ? "Public" : "Private"}
                    </Label>
                    <Switch
                      id="routine-public"
                      checked={routineIsPublic}
                      onCheckedChange={setRoutineIsPublic}
                      data-testid="switch-routine-public"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className={LABEL_EYEBROW}>Weekly Schedule</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCurrentWeekOffset(Math.max(0, currentWeekOffset - 1))}
                        disabled={currentWeekOffset === 0}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border bg-white/[0.04] text-muted-foreground hover:text-foreground disabled:opacity-40"
                        data-testid="button-prev-week"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="min-w-[92px] text-center font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                        Week {currentWeekOffset + 1} / {totalWeeks}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCurrentWeekOffset(Math.min(totalWeeks - 1, currentWeekOffset + 1))}
                        disabled={currentWeekOffset >= totalWeeks - 1}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border bg-white/[0.04] text-muted-foreground hover:text-foreground disabled:opacity-40"
                        data-testid="button-next-week"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {totalWeeks > 1 && currentWeekOffset < totalWeeks - 1 && (
                    <button
                      type="button"
                      onClick={copyWeekToNext}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border-strong bg-white/[0.03] text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                      data-testid="button-copy-week"
                    >
                      <Copy className="h-4 w-4" />
                      Copy Week {currentWeekOffset + 1} to Week {currentWeekOffset + 2}
                    </button>
                  )}

                  <div className="space-y-2">
                    {currentWeekDays.map(dayIndex => {
                      const entry = routineEntries.find(e => e.dayIndex === dayIndex);
                      return (
                        <div key={dayIndex} className="flex items-center gap-3 rounded-xl border bg-white/[0.03] p-2.5">
                          <span className="w-14 shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-tertiary-foreground">Day {dayIndex}</span>
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

            <DialogFooter>
              <button type="button" onClick={closeBuilder} className={BTN_SECONDARY} data-testid="button-cancel-routine">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRoutine}
                disabled={createRoutineMutation.isPending || updateRoutineMutation.isPending}
                className={CTA_DIALOG}
                data-testid="button-save-routine"
              >
                {editingRoutine ? "Save Changes" : "Create Routine"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Start routine modal */}
        <Dialog open={isApplyModalOpen} onOpenChange={(open) => { if (!open) { setIsApplyModalOpen(false); setApplyingRoutine(null); } }}>
          <DialogContent data-testid="dialog-apply-routine">
            <DialogHeader>
              <DialogTitle>Start Routine</DialogTitle>
              <DialogDescription>
                Start "{applyingRoutine?.name}" and track your progress.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className={LABEL_EYEBROW}>Start Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="flex h-12 w-full items-center gap-2 rounded-[10px] border bg-input px-4 text-left text-base text-foreground" data-testid="button-apply-start-date">
                      <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                      {format(applyStartDate, "PPP")}
                    </button>
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
                <Label className={LABEL_EYEBROW}>Duration</Label>
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

              <div className="flex gap-3 rounded-xl border-[1.5px] border-yellow bg-primary-dim p-3.5">
                <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-[13px] leading-relaxed text-foreground/85">
                  Workouts will be scheduled from{" "}
                  <strong className="text-foreground">{format(applyStartDate, "PPP")}</strong> to{" "}
                  <strong className="text-foreground">{format(addDays(applyStartDate, applyDuration - 1), "PPP")}</strong>.
                </p>
              </div>
            </div>

            <DialogFooter>
              <button type="button" onClick={() => { setIsApplyModalOpen(false); setApplyingRoutine(null); }} className={BTN_SECONDARY} data-testid="button-cancel-apply">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStartRoutine}
                disabled={startRoutineMutation.isPending}
                className={CTA_DIALOG}
                data-testid="button-confirm-apply"
              >
                {startRoutineMutation.isPending ? "Starting..." : "Start Routine"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Update active instances confirm */}
        <Dialog open={!!updateActiveRoutineId} onOpenChange={(open) => { if (!open) setUpdateActiveRoutineId(null); }}>
          <DialogContent data-testid="dialog-update-active-instances">
            <DialogHeader>
              <DialogTitle>Update Active Routine?</DialogTitle>
              <DialogDescription>
                This routine is currently in progress. Would you like to update the remaining scheduled workouts with the new changes?
              </DialogDescription>
            </DialogHeader>

            <p className="py-2 text-sm text-muted-foreground">
              Only future workouts that haven't been completed yet will be updated. Past and completed workouts will remain unchanged.
            </p>

            <DialogFooter>
              <button type="button" onClick={() => setUpdateActiveRoutineId(null)} className={BTN_SECONDARY} data-testid="button-skip-update-active">
                Skip
              </button>
              <button
                type="button"
                onClick={() => updateActiveRoutineId && updateActiveInstancesMutation.mutate(updateActiveRoutineId)}
                disabled={updateActiveInstancesMutation.isPending}
                className={CTA_DIALOG}
                data-testid="button-confirm-update-active"
              >
                {updateActiveInstancesMutation.isPending ? "Updating..." : "Update Future Workouts"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
