"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/ThemeProvider";
import { useSettings, type WeekStart, DEFAULT_MUSCLE_GROUPS } from "@/components/SettingsProvider";
import { isCustomMuscleGroup } from "@/lib/db/schema";
import { Sun, Moon, Monitor, Calendar, Plus, X, ChevronUp, ChevronDown, RotateCcw, RefreshCw, Check, AlertCircle, Timer, Link2, Unlink } from "lucide-react";
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
      <div className="max-w-2xl mx-auto p-4 sm:p-6 pb-8 sm:pb-12 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold" data-testid="text-page-title">
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customize your app experience
          </p>
        </div>

        <FitYearGoalsCard />

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Week Start</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Choose when your week begins for weekly statistics
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
            <RadioGroup
              value={weekStart}
              onValueChange={(value) => setWeekStart(value as WeekStart)}
              className="space-y-3"
            >
              {weekStartOptions.map((option) => (
                <div
                  key={option.value}
                  className={`flex items-center space-x-3 p-3 rounded-md border cursor-pointer hover-elevate ${
                    weekStart === option.value ? 'border-primary bg-primary/5' : ''
                  }`}
                  onClick={() => setWeekStart(option.value as WeekStart)}
                  data-testid={`option-weekstart-${option.value}`}
                >
                  <RadioGroupItem value={option.value} id={`weekstart-${option.value}`} />
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <Label htmlFor={`weekstart-${option.value}`} className="font-medium cursor-pointer">
                      {option.label}
                    </Label>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base sm:text-lg">Google Calendar Sync</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  {calendarStatus?.connected 
                    ? "Choose which calendar receives your completed workout events" 
                    : "Connect your Google Calendar to sync workout events"}
                </CardDescription>
              </div>
              {calendarStatus?.connected && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => refetchCalendars()}
                  disabled={calendarsLoading}
                  data-testid="button-refresh-calendars"
                >
                  <RefreshCw className={`h-4 w-4 ${calendarsLoading ? 'animate-spin' : ''}`} />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0">
            {statusLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-full" />
              </div>
            ) : !calendarStatus?.connected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-4 rounded-md border bg-muted/50">
                  <Calendar className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm">Calendar not connected</p>
                    <p className="text-xs text-muted-foreground">Connect your Google Calendar to automatically sync your completed workouts as calendar events.</p>
                  </div>
                </div>
                <Button
                  onClick={handleConnectCalendar}
                  disabled={isConnecting || connectCalendarMutation.isPending}
                  className="w-full"
                  data-testid="button-connect-calendar"
                >
                  <Link2 className="h-4 w-4 mr-2" />
                  {isConnecting || connectCalendarMutation.isPending ? "Connecting..." : "Connect Google Calendar"}
                </Button>
              </div>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg">Workout Tracking</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Customize how workout tracking behaves
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-3">
            <div
              className={`flex items-center justify-between gap-3 p-3 rounded-md border cursor-pointer hover-elevate ${
                restTimerOnManualComplete ? 'border-primary bg-primary/5' : ''
              }`}
              onClick={() => setRestTimerOnManualComplete(!restTimerOnManualComplete)}
              data-testid="option-rest-timer-manual"
            >
              <div className="flex items-center gap-3 flex-1">
                <Timer className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="font-medium text-sm">Rest timer on manual completion</p>
                  <p className="text-xs text-muted-foreground">
                    Start rest timer when manually checking off a set
                  </p>
                </div>
              </div>
              <Switch
                checked={restTimerOnManualComplete}
                onCheckedChange={setRestTimerOnManualComplete}
                data-testid="switch-rest-timer-manual"
              />
            </div>

            <div className="flex items-center justify-between gap-3 p-3 rounded-md border" data-testid="option-weight-unit">
              <div>
                <p className="font-medium text-sm">Weight unit</p>
                <p className="text-xs text-muted-foreground">Used when entering set weights during tracking</p>
              </div>
              <div className="flex gap-1 shrink-0">
                {(['lbs', 'kg'] as const).map(unit => {
                  const active = (userSettings?.weightUnit ?? 'lbs') === unit;
                  return (
                    <Button
                      key={unit}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      onClick={() => updateWeightUnitMutation.mutate(unit)}
                      data-testid={`button-weight-unit-${unit}`}
                    >
                      {unit}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div
              className={`flex items-center justify-between gap-3 p-3 rounded-md border cursor-pointer hover-elevate ${
                showKgConversion ? 'border-primary bg-primary/5' : ''
              }`}
              onClick={() => setShowKgConversion(!showKgConversion)}
              data-testid="option-show-kg-conversion"
            >
              <div className="flex-1">
                <p className="font-medium text-sm">Show unit conversion</p>
                <p className="text-xs text-muted-foreground">
                  Show the equivalent weight in the other unit below each input (lbs ↔ kg)
                </p>
              </div>
              <Switch
                checked={showKgConversion}
                onCheckedChange={setShowKgConversion}
                data-testid="switch-show-kg-conversion"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base sm:text-lg">Muscle Groups</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Customize which muscle groups appear in your exercise library
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetMuscleGroups}
                data-testid="button-reset-muscle-groups"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Reset
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0 sm:pt-0 space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Add new muscle group..."
                value={newMuscleGroup}
                onChange={(e) => setNewMuscleGroup(e.target.value)}
                onKeyPress={handleKeyPress}
                data-testid="input-new-muscle-group"
              />
              <Button
                onClick={handleAddMuscleGroup}
                disabled={!newMuscleGroup.trim() || muscleGroups.includes(newMuscleGroup.trim())}
                data-testid="button-add-muscle-group"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2">
              {muscleGroups.map((group, index) => {
                const isCustom = isCustomMuscleGroup(group);
                return (
                  <div
                    key={group}
                    className="flex items-center gap-2 p-3 rounded-md border bg-background"
                    data-testid={`muscle-group-item-${group.toLowerCase()}`}
                  >
                    <span className="flex-1 font-medium text-sm">
                      {group}
                      {!isCustom && <span className="text-xs text-muted-foreground ml-2">(default)</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => reorderMuscleGroups(index, Math.max(0, index - 1))}
                        disabled={index === 0}
                        data-testid={`button-move-up-${group.toLowerCase()}`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => reorderMuscleGroups(index, Math.min(muscleGroups.length - 1, index + 1))}
                        disabled={index === muscleGroups.length - 1}
                        data-testid={`button-move-down-${group.toLowerCase()}`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeMuscleGroup(group)}
                        disabled={!isCustom}
                        className={!isCustom ? "opacity-30 cursor-not-allowed" : ""}
                        data-testid={`button-remove-${group.toLowerCase()}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {muscleGroups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No muscle groups defined. Add some or reset to defaults.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Data Migration */}
        <Card data-testid="card-data-migration">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Workout Template History
            </CardTitle>
            <CardDescription>
              Link your existing scheduled and completed workouts to their source templates to track completion history.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium">Sync Template Connections</p>
                <p className="text-xs text-muted-foreground">
                  Match workouts to templates by name to enable completion tracking
                </p>
              </div>
              <Button
                onClick={handleMigrateTemplateIds}
                disabled={migrateTemplateIdsMutation.isPending}
                data-testid="button-sync-template-history"
              >
                {migrateTemplateIdsMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sync Now
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
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
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-base sm:text-lg">Goals & Fit Bot</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Monthly targets and Fit Bot defaults
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 space-y-5">
        <div className="space-y-2">
          <Label className="text-sm font-medium">Monthly workout target</Label>
          <p className="text-xs text-muted-foreground">
            Used by the home goals strip
          </p>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                update.mutate({
                  monthlyWorkoutGoal: Math.max(1, monthlyGoal - 1),
                })
              }
              disabled={monthlyGoal <= 1}
            >
              −
            </Button>
            <span className="min-w-[3rem] text-center text-2xl font-bold tabular-nums">
              {monthlyGoal}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() =>
                update.mutate({
                  monthlyWorkoutGoal: Math.min(31, monthlyGoal + 1),
                })
              }
              disabled={monthlyGoal >= 31}
            >
              +
            </Button>
            <span className="text-sm text-muted-foreground">workouts / month</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Fit Bot default focus</Label>
          <p className="text-xs text-muted-foreground">
            Pre-selects this when you open Fit Bot
          </p>
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
      </CardContent>
    </Card>
  );
}