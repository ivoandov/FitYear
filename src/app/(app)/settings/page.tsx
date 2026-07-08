"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import { useSettings, type WeekStart, DEFAULT_MUSCLE_GROUPS } from "@/components/SettingsProvider";
import { isCustomMuscleGroup } from "@/lib/db/schema";
import { ArrowLeft, Sun, Moon, Monitor, Calendar, Plus, X, ChevronUp, ChevronDown, RotateCcw, RefreshCw, Check, AlertCircle, Link2, Unlink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useRouter, useSearchParams } from "next/navigation";

interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

interface UserSettings {
  userId: string;
  selectedCalendarId: string | null;
  selectedCalendarName: string | null;
  weightUnit: string | null;
}

// A+ refresh primitives: the signature elevated card, mono section eyebrow,
// and the shared row title / helper text scale used across every settings block.
const CARD = "card-elevated p-[18px]";
const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.14em] text-tertiary-foreground";
const ROW_TITLE = "text-sm font-semibold text-foreground";
const ROW_HELP = "mt-0.5 text-xs text-muted-foreground";

// Segmented pill control (weight unit, week start). Active pill = neon fill
// (black text) or the subtle rgba-white treatment, per the refresh spec.
function Segmented({
  options,
  value,
  onChange,
  variant = "neon",
  mono = false,
  getTestId,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  variant?: "neon" | "subtle";
  mono?: boolean;
  getTestId?: (v: string) => string;
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded-[10px] border bg-input p-[3px]">
      {options.map((opt) => {
        const active = value === opt.value;
        const activeCls =
          variant === "neon"
            ? "bg-primary font-bold text-primary-foreground"
            : "border border-strong bg-white/[0.08] font-bold text-foreground";
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            data-testid={getTestId?.(opt.value)}
            className={`rounded-[7px] px-3.5 py-1.5 text-[13px] transition-colors ${mono ? "font-mono " : ""}${active ? activeCls : "font-semibold text-muted-foreground"}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { weekStart, setWeekStart, muscleGroups, addMuscleGroup, removeMuscleGroup, reorderMuscleGroups, setMuscleGroups, restTimerOnManualComplete, setRestTimerOnManualComplete, showKgConversion, setShowKgConversion } = useSettings();
  const [newMuscleGroup, setNewMuscleGroup] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Check for calendar connection callback params
  useEffect(() => {
    const params = searchParams;
    if (params.get('calendar_connected') === 'true') {
      toast({
        title: "Calendar connected",
        description: "Your Google Calendar has been connected successfully.",
      });
      router.push('/settings');
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/list'] });
    }
    const error = params.get('calendar_error');
    if (error) {
      toast({
        title: "Calendar connection failed",
        description: decodeURIComponent(error),
        variant: "destructive",
      });
      router.push('/settings');
    }
  }, [searchParams, toast, router]);

  // Check if calendar is connected
  const { data: calendarStatus, isLoading: statusLoading } = useQuery<{ connected: boolean }>({
    queryKey: ['/api/calendar/status'],
  });

  // Fetch available Google Calendars (only if connected)
  const { data: calendars, isLoading: calendarsLoading, error: calendarsError, refetch: refetchCalendars } = useQuery<CalendarInfo[]>({
    queryKey: ['/api/calendar/list'],
    enabled: calendarStatus?.connected === true,
  });

  // Fetch user settings
  const { data: userSettings, isLoading: settingsLoading } = useQuery<UserSettings>({
    queryKey: ['/api/user-settings'],
  });

  // Connect calendar mutation
  const connectCalendarMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('GET', '/api/calendar/connect');
      return response.json();
    },
    onSuccess: (data: { authUrl: string }) => {
      window.location.href = data.authUrl;
    },
    onError: (error) => {
      toast({
        title: "Failed to connect calendar",
        description: describeApiError(error),
        variant: "destructive",
      });
      setIsConnecting(false);
    },
  });

  // Disconnect calendar mutation
  const disconnectCalendarMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', '/api/calendar/disconnect');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/calendar/list'] });
      queryClient.invalidateQueries({ queryKey: ['/api/user-settings'] });
      toast({
        title: "Calendar disconnected",
        description: "Your Google Calendar has been disconnected.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to disconnect calendar",
        description: describeApiError(error),
        variant: "destructive",
      });
    },
  });

  // State for sync results
  const [syncResults, setSyncResults] = useState<{
    workouts: { name: string; date: string; status: string; eventId?: string }[];
    created: number;
    alreadySynced: number;
    failed: number;
  } | null>(null);

  type SyncResult = { created: number; alreadySynced: number; failed: number; workouts: { name: string; date: string; status: string; eventId?: string }[] };

  const onSyncSuccess = (data: SyncResult, label: string) => {
    setSyncResults(data);
    const parts: string[] = [];
    if (data.created > 0) parts.push(`${data.created} added`);
    if (data.alreadySynced > 0) parts.push(`${data.alreadySynced} already synced`);
    if (data.failed > 0) parts.push(`${data.failed} failed`);
    toast({ title: `${label} sync complete`, description: parts.length > 0 ? parts.join(', ') : 'Nothing new to sync' });
  };

  const syncPastMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/calendar/sync-completed-workouts');
      return response.json() as Promise<SyncResult>;
    },
    onSuccess: (data) => onSyncSuccess(data, 'Past workouts'),
    onError: (error: any) => {
      setSyncResults(null);
      toast({ title: "Failed to sync past workouts", description: error?.message || "Please try again.", variant: "destructive" });
    },
  });

  const handleConnectCalendar = () => {
    setIsConnecting(true);
    connectCalendarMutation.mutate();
  };

  const handleDisconnectCalendar = () => {
    disconnectCalendarMutation.mutate();
  };

  // Mutation to update weight unit preference
  const updateWeightUnitMutation = useMutation({
    mutationFn: async (unit: 'lbs' | 'kg') => {
      return apiRequest('PATCH', '/api/user-settings', { weightUnit: unit });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-settings'] });
    },
  });

  // Mutation to update calendar selection
  const updateCalendarMutation = useMutation({
    mutationFn: async ({ calendarId, calendarName }: { calendarId: string; calendarName: string }) => {
      return apiRequest('PATCH', '/api/user-settings', {
        selectedCalendarId: calendarId,
        selectedCalendarName: calendarName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-settings'] });
      toast({
        title: "Calendar updated",
        description: "Your workout sync calendar has been changed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to update calendar",
        description: describeApiError(error),
        variant: "destructive",
      });
    },
  });

  const handleSelectCalendar = (calendar: CalendarInfo) => {
    updateCalendarMutation.mutate({
      calendarId: calendar.id,
      calendarName: calendar.summary,
    });
  };

  // Migrate template IDs for existing workouts
  const migrateTemplateIdsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/migrate-template-ids');
      return response.json();
    },
    onSuccess: (data: { scheduledUpdated: number; completedUpdated: number; message: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/scheduled-workouts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/completed-workouts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/workout-templates'] });
      toast({
        title: "Template history synced",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to sync template history",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleMigrateTemplateIds = () => {
    migrateTemplateIdsMutation.mutate();
  };

  const themeOptions = [
    {
      value: "light",
      label: "Light",
      description: "Default light theme",
      icon: Sun,
    },
    {
      value: "dark",
      label: "Dark",
      description: "Dark theme for low-light environments",
      icon: Moon,
    },
    {
      value: "system",
      label: "System",
      description: "Follows your device settings",
      icon: Monitor,
    },
  ];

  const weekStartOptions = [
    {
      value: "sunday",
      label: "Sunday",
      description: "Week starts on Sunday",
    },
    {
      value: "monday",
      label: "Monday",
      description: "Week starts on Monday",
    },
  ];

  const handleAddMuscleGroup = () => {
    if (newMuscleGroup.trim()) {
      addMuscleGroup(newMuscleGroup.trim());
      setNewMuscleGroup("");
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddMuscleGroup();
    }
  };

  const handleResetMuscleGroups = () => {
    setMuscleGroups([...DEFAULT_MUSCLE_GROUPS]);
  };

  return (
    <div className="flex-1 overflow-auto h-full">
      <div className="mx-auto max-w-2xl space-y-5 p-4 pb-8 sm:p-6 sm:pb-12">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-white/[0.03] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
          <h1 className="text-2xl font-bold tracking-[-0.02em]" data-testid="text-page-title">
            Settings
          </h1>
        </div>

        <FitYearGoalsCard />

        <div className={CARD}>
          <div className={`${EYEBROW} mb-4`}>Workout tracking</div>

          <div className="flex items-center justify-between gap-3" data-testid="option-weight-unit">
            <div className="min-w-0">
              <div className={ROW_TITLE}>Weight unit</div>
              <div className={ROW_HELP}>Used when entering set weights</div>
            </div>
            <Segmented
              mono
              value={userSettings?.weightUnit ?? "lbs"}
              onChange={(v) => updateWeightUnitMutation.mutate(v as "lbs" | "kg")}
              options={[
                { value: "lbs", label: "lbs" },
                { value: "kg", label: "kg" },
              ]}
              getTestId={(v) => `button-weight-unit-${v}`}
            />
          </div>

          <div
            className="mt-4 flex cursor-pointer items-center justify-between gap-3 border-t border-divider pt-4"
            onClick={() => setRestTimerOnManualComplete(!restTimerOnManualComplete)}
            data-testid="option-rest-timer-manual"
          >
            <div className="min-w-0">
              <div className={ROW_TITLE}>Rest timer on completion</div>
              <div className={ROW_HELP}>Start rest when checking off a set</div>
            </div>
            <Switch
              checked={restTimerOnManualComplete}
              onCheckedChange={setRestTimerOnManualComplete}
              data-testid="switch-rest-timer-manual"
            />
          </div>

          <div
            className="mt-4 flex cursor-pointer items-center justify-between gap-3 border-t border-divider pt-4"
            onClick={() => setShowKgConversion(!showKgConversion)}
            data-testid="option-show-kg-conversion"
          >
            <div className="min-w-0">
              <div className={ROW_TITLE}>Show unit conversion</div>
              <div className={ROW_HELP}>Show lb equivalent below each input</div>
            </div>
            <Switch
              checked={showKgConversion}
              onCheckedChange={setShowKgConversion}
              data-testid="switch-show-kg-conversion"
            />
          </div>
        </div>

        <div className={CARD}>
          <div className={`${EYEBROW} mb-4`}>General</div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={ROW_TITLE}>Week starts on</div>
              <div className={ROW_HELP}>For weekly statistics</div>
            </div>
            <Segmented
              variant="subtle"
              value={weekStart}
              onChange={(v) => setWeekStart(v as WeekStart)}
              options={[
                { value: "sunday", label: "Sun" },
                { value: "monday", label: "Mon" },
              ]}
              getTestId={(v) => `option-weekstart-${v}`}
            />
          </div>
        </div>

        <div className={CARD}>
          <div className="mb-4 flex items-center justify-between">
            <div className={EYEBROW}>Integrations</div>
            {calendarStatus?.connected && (
              <button
                type="button"
                onClick={() => refetchCalendars()}
                disabled={calendarsLoading}
                aria-label="Refresh calendars"
                data-testid="button-refresh-calendars"
                className="flex h-9 w-9 items-center justify-center rounded-[10px] border bg-white/[0.03] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${calendarsLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-white/[0.05] text-muted-foreground">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={ROW_TITLE}>Google Calendar</div>
              <div className={ROW_HELP}>
                {calendarStatus?.connected
                  ? "Choose which calendar receives your workouts"
                  : "Sync completed workouts as events"}
              </div>
            </div>
          </div>

          {statusLoading ? (
            <Skeleton className="h-12 w-full rounded-xl" />
          ) : !calendarStatus?.connected ? (
            <button
              type="button"
              onClick={handleConnectCalendar}
              disabled={isConnecting || connectCalendarMutation.isPending}
              data-testid="button-connect-calendar"
              className="flex h-[46px] w-full items-center justify-center gap-2 rounded-[13px] border border-yellow bg-primary-dim text-sm font-bold text-primary disabled:opacity-60"
            >
              <Link2 className="h-4 w-4" />
              {isConnecting || connectCalendarMutation.isPending ? "Connecting..." : "Connect Google Calendar"}
            </button>
            ) : calendarsLoading || settingsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : calendarsError ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-4 rounded-md border border-destructive/50 bg-destructive/10 text-destructive">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Unable to load calendars</p>
                    <p className="text-xs">There was an issue fetching your calendars. Try disconnecting and reconnecting.</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleDisconnectCalendar}
                  disabled={disconnectCalendarMutation.isPending}
                  className="w-full"
                  data-testid="button-disconnect-calendar"
                >
                  <Unlink className="h-4 w-4 mr-2" />
                  {disconnectCalendarMutation.isPending ? "Disconnecting..." : "Disconnect Calendar"}
                </Button>
              </div>
            ) : calendars && calendars.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  {calendars.map((calendar) => {
                    const isSelected = userSettings?.selectedCalendarId === calendar.id || 
                      (!userSettings?.selectedCalendarId && calendar.primary);
                    return (
                      <div
                        key={calendar.id}
                        className={`flex items-center gap-3 p-3 rounded-md border cursor-pointer hover-elevate ${
                          isSelected ? 'border-primary bg-primary/5' : ''
                        }`}
                        onClick={() => handleSelectCalendar(calendar)}
                        data-testid={`option-calendar-${calendar.id}`}
                      >
                        <div
                          className="w-4 h-4 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: calendar.backgroundColor || '#4285f4' }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{calendar.summary}</p>
                          {calendar.primary && (
                            <p className="text-xs text-muted-foreground">Primary calendar</p>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="h-5 w-5 text-primary flex-shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => syncPastMutation.mutate()}
                    disabled={syncPastMutation.isPending}
                    className="flex-1"
                    data-testid="button-sync-past-workouts"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncPastMutation.isPending ? 'animate-spin' : ''}`} />
                    {syncPastMutation.isPending ? "Syncing..." : "Sync Past Workouts"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDisconnectCalendar}
                    disabled={disconnectCalendarMutation.isPending}
                    className="flex-1"
                    data-testid="button-disconnect-calendar"
                  >
                    <Unlink className="h-4 w-4 mr-2" />
                    {disconnectCalendarMutation.isPending ? "Disconnecting..." : "Disconnect"}
                  </Button>
                </div>
                {syncResults && syncResults.workouts.length > 0 && (
                  <div className="mt-4 border rounded-lg p-3 bg-muted/30">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium">Sync Results ({syncResults.workouts.length} workouts)</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSyncResults(null)}
                        className="h-6 px-2"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {syncResults.workouts.map((w, i) => (
                        <div
                          key={i}
                          className={`text-xs p-2 rounded ${
                            w.status === 'created' ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
                            w.status === 'already_synced' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                            'bg-red-500/10 text-red-600 dark:text-red-400'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium truncate flex-1 mr-2">{w.name}</span>
                            <span className="text-muted-foreground mr-2">{w.date}</span>
                            <span className={`text-xs ${
                              w.status === 'created' ? 'text-green-600 dark:text-green-400' :
                              w.status === 'already_synced' ? 'text-blue-600 dark:text-blue-400' :
                              'text-red-600 dark:text-red-400'
                            }`}>
                              {w.status === 'created' ? 'Created' :
                               w.status === 'already_synced' ? 'Already synced' : 'Failed'}
                            </span>
                          </div>
                          {w.eventId && (
                            <div className="text-[10px] text-muted-foreground mt-1 truncate">
                              Event ID: {w.eventId}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center py-4">
                  No calendars available.
                </p>
                <Button
                  variant="outline"
                  onClick={handleDisconnectCalendar}
                  disabled={disconnectCalendarMutation.isPending}
                  className="w-full"
                  data-testid="button-disconnect-calendar"
                >
                  <Unlink className="h-4 w-4 mr-2" />
                  {disconnectCalendarMutation.isPending ? "Disconnecting..." : "Disconnect Calendar"}
                </Button>
              </div>
            )}
        </div>

        <div className={CARD}>
          <div className="mb-4 flex items-center justify-between">
            <div className={EYEBROW}>Muscle groups</div>
            <button
              type="button"
              onClick={handleResetMuscleGroups}
              data-testid="button-reset-muscle-groups"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>

          {muscleGroups.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {muscleGroups.map((group, index) => {
                const isCustom = isCustomMuscleGroup(group);
                return (
                  <div
                    key={group}
                    className="flex items-center gap-0.5 rounded-full border bg-white/[0.05] py-1 pl-3 pr-1 text-[13px] text-foreground"
                    data-testid={`muscle-group-item-${group.toLowerCase()}`}
                  >
                    <span className="mr-1">{group}</span>
                    <button
                      type="button"
                      onClick={() => reorderMuscleGroups(index, Math.max(0, index - 1))}
                      disabled={index === 0}
                      aria-label={`Move ${group} up`}
                      data-testid={`button-move-up-${group.toLowerCase()}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-tertiary-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderMuscleGroups(index, Math.min(muscleGroups.length - 1, index + 1))}
                      disabled={index === muscleGroups.length - 1}
                      aria-label={`Move ${group} down`}
                      data-testid={`button-move-down-${group.toLowerCase()}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-tertiary-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMuscleGroup(group)}
                      disabled={!isCustom}
                      aria-label={`Remove ${group}`}
                      data-testid={`button-remove-${group.toLowerCase()}`}
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-tertiary-foreground hover:text-foreground ${
                        !isCustom ? "cursor-not-allowed opacity-30" : ""
                      }`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No muscle groups defined. Add some or reset to defaults.
            </p>
          )}

          <div className="mt-4 flex items-center gap-2 rounded-xl border bg-input py-1.5 pl-3.5 pr-1.5">
            <input
              placeholder="Add muscle group…"
              value={newMuscleGroup}
              onChange={(e) => setNewMuscleGroup(e.target.value)}
              onKeyPress={handleKeyPress}
              data-testid="input-new-muscle-group"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary-foreground"
            />
            <button
              type="button"
              onClick={handleAddMuscleGroup}
              disabled={!newMuscleGroup.trim() || muscleGroups.includes(newMuscleGroup.trim())}
              aria-label="Add muscle group"
              data-testid="button-add-muscle-group"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Data Migration */}
        <div className={CARD} data-testid="card-data-migration">
          <div className={`${EYEBROW} mb-4`}>Workout template history</div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={ROW_TITLE}>Sync template connections</div>
              <div className={ROW_HELP}>
                Match workouts to templates by name to enable completion tracking
              </div>
            </div>
            <Button
              onClick={handleMigrateTemplateIds}
              disabled={migrateTemplateIdsMutation.isPending}
              data-testid="button-sync-template-history"
              className="shrink-0"
            >
              {migrateTemplateIdsMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Sync Now
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FitYearGoalsCard() {
  const { data: settings } = useQuery<{
    monthlyWorkoutGoal?: number | null;
    fitbotDefaultFocus?: string | null;
  }>({ queryKey: ["/api/user-settings"] });
  const { toast } = useToast();
  const monthlyGoal = settings?.monthlyWorkoutGoal ?? 16;
  const focus = settings?.fitbotDefaultFocus ?? "strength";

  const update = useMutation({
    mutationFn: async (vars: { monthlyWorkoutGoal?: number; fitbotDefaultFocus?: string }) => {
      return apiRequest("PATCH", "/api/user-settings", vars);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
    },
    onError: (error) => {
      toast({ title: "Couldn't save settings", description: describeApiError(error), variant: "destructive" });
    },
  });

  const focusOptions = [
    { value: "strength", label: "Strength" },
    { value: "hypertrophy", label: "Hypertrophy" },
    { value: "calisthenics", label: "Calisthenics" },
    { value: "flexibility", label: "Flexibility" },
    { value: "mixed", label: "Mixed" },
    { value: "athletic", label: "Athletic" },
  ];

  return (
    <div className={CARD}>
      <div className={`${EYEBROW} mb-4`}>Goals &amp; FitBot</div>

      <div className="mb-5">
        <div className={ROW_TITLE}>Monthly target</div>
        <div className={ROW_HELP}>Used by the home goals strip</div>
        <div className="mt-3 flex items-center gap-3.5">
          <button
            type="button"
            onClick={() =>
              update.mutate({
                monthlyWorkoutGoal: Math.max(1, monthlyGoal - 1),
              })
            }
            disabled={monthlyGoal <= 1}
            aria-label="Decrease monthly target"
            className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-strong bg-white/[0.03] text-xl leading-none text-muted-foreground disabled:opacity-40"
          >
            −
          </button>
          <span className="min-w-[40px] text-center font-mono text-[26px] font-bold tabular-nums text-foreground">
            {monthlyGoal}
          </span>
          <button
            type="button"
            onClick={() =>
              update.mutate({
                monthlyWorkoutGoal: Math.min(31, monthlyGoal + 1),
              })
            }
            disabled={monthlyGoal >= 31}
            aria-label="Increase monthly target"
            className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-strong bg-white/[0.03] text-xl leading-none text-primary disabled:opacity-40"
          >
            +
          </button>
          <span className="text-[13px] text-muted-foreground">workouts / month</span>
        </div>
      </div>

      <div>
        <div className={`${ROW_TITLE} mb-2`}>FitBot default focus</div>
        <Select
          value={focus}
          onValueChange={(value) => {
            if (value) update.mutate({ fitbotDefaultFocus: value });
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {focusOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}