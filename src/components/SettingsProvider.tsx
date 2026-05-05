"use client";

import { createContext, useContext, useState } from "react";
import { DEFAULT_MUSCLE_GROUPS as SHARED_DEFAULT_MUSCLE_GROUPS } from "@/lib/db/schema";

export type WeekStart = "sunday" | "monday";

export const DEFAULT_MUSCLE_GROUPS = [...SHARED_DEFAULT_MUSCLE_GROUPS];

type SettingsProviderProps = {
  children: React.ReactNode;
};

type SettingsProviderState = {
  weekStart: WeekStart;
  setWeekStart: (weekStart: WeekStart) => void;
  muscleGroups: string[];
  customMuscleGroups: string[];
  setMuscleGroups: (groups: string[]) => void;
  addMuscleGroup: (group: string) => void;
  removeMuscleGroup: (group: string) => void;
  reorderMuscleGroups: (fromIndex: number, toIndex: number) => void;
  restTimerOnManualComplete: boolean;
  setRestTimerOnManualComplete: (enabled: boolean) => void;
  showKgConversion: boolean;
  setShowKgConversion: (enabled: boolean) => void;
  isCustomMuscleGroup: (group: string) => boolean;
};

const SettingsProviderContext = createContext<SettingsProviderState | undefined>(undefined);

function migrateToCustomGroups(): string[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem("muscleGroups");
  const migrated = localStorage.getItem("muscleGroupsMigrated");
  
  if (migrated === "v2") {
    const customStored = localStorage.getItem("customMuscleGroups");
    if (customStored) {
      try {
        return JSON.parse(customStored);
      } catch {
        return [];
      }
    }
    return [];
  }
  
  if (stored) {
    try {
      const allGroups: string[] = JSON.parse(stored);
      const defaultLower = DEFAULT_MUSCLE_GROUPS.map(g => g.toLowerCase());
      // Keep any group that's not in the new defaults
      // "Core" is kept as custom since default is now "Abs/Core"
      const customGroups = allGroups.filter(g => 
        !defaultLower.includes(g.toLowerCase())
      );
      localStorage.setItem("customMuscleGroups", JSON.stringify(customGroups));
      localStorage.setItem("muscleGroupsMigrated", "v2");
      return customGroups;
    } catch {
      localStorage.setItem("muscleGroupsMigrated", "v2");
      return [];
    }
  }
  
  localStorage.setItem("muscleGroupsMigrated", "v2");
  return [];
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [weekStart, setWeekStartState] = useState<WeekStart>(() => {
    if (typeof window === "undefined") return "sunday";
    const stored = localStorage.getItem("weekStart");
    return (stored as WeekStart) || "sunday";
  });

  const [customMuscleGroups, setCustomMuscleGroupsState] = useState<string[]>(() => {
    return migrateToCustomGroups();
  });

  const muscleGroups = [...DEFAULT_MUSCLE_GROUPS, ...customMuscleGroups];

  const setWeekStart = (newWeekStart: WeekStart) => {
    setWeekStartState(newWeekStart);
    localStorage.setItem("weekStart", newWeekStart);
  };

  const setCustomMuscleGroups = (groups: string[]) => {
    setCustomMuscleGroupsState(groups);
    localStorage.setItem("customMuscleGroups", JSON.stringify(groups));
  };

  const setMuscleGroups = (groups: string[]) => {
    const customOnly = groups.filter(g => 
      !DEFAULT_MUSCLE_GROUPS.map(d => d.toLowerCase()).includes(g.toLowerCase())
    );
    setCustomMuscleGroups(customOnly);
  };

  const addMuscleGroup = (group: string) => {
    const trimmed = group.trim();
    if (!trimmed) return;
    
    const allLower = muscleGroups.map(g => g.toLowerCase());
    if (allLower.includes(trimmed.toLowerCase())) return;
    
    const newCustomGroups = [...customMuscleGroups, trimmed];
    setCustomMuscleGroups(newCustomGroups);
  };

  const removeMuscleGroup = (group: string) => {
    if (DEFAULT_MUSCLE_GROUPS.map(g => g.toLowerCase()).includes(group.toLowerCase())) {
      return;
    }
    const newCustomGroups = customMuscleGroups.filter((g) => g !== group);
    setCustomMuscleGroups(newCustomGroups);
  };

  const reorderMuscleGroups = (fromIndex: number, toIndex: number) => {
    const newGroups = [...muscleGroups];
    const [removed] = newGroups.splice(fromIndex, 1);
    newGroups.splice(toIndex, 0, removed);
    const customOnly = newGroups.filter(g => 
      !DEFAULT_MUSCLE_GROUPS.map(d => d.toLowerCase()).includes(g.toLowerCase())
    );
    setCustomMuscleGroups(customOnly);
  };
  
  const isCustomMuscleGroup = (group: string) => {
    return !DEFAULT_MUSCLE_GROUPS.map(g => g.toLowerCase()).includes(group.toLowerCase());
  };

  const [restTimerOnManualComplete, setRestTimerOnManualCompleteState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("restTimerOnManualComplete");
    return stored === "true";
  });

  const setRestTimerOnManualComplete = (enabled: boolean) => {
    setRestTimerOnManualCompleteState(enabled);
    localStorage.setItem("restTimerOnManualComplete", enabled.toString());
  };

  const [showKgConversion, setShowKgConversionState] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("showKgConversion");
    return stored === "true";
  });

  const setShowKgConversion = (enabled: boolean) => {
    setShowKgConversionState(enabled);
    localStorage.setItem("showKgConversion", enabled.toString());
  };

  return (
    <SettingsProviderContext.Provider
      value={{
        weekStart,
        setWeekStart,
        muscleGroups,
        customMuscleGroups,
        setMuscleGroups,
        addMuscleGroup,
        removeMuscleGroup,
        reorderMuscleGroups,
        restTimerOnManualComplete,
        setRestTimerOnManualComplete,
        showKgConversion,
        setShowKgConversion,
        isCustomMuscleGroup,
      }}
    >
      {children}
    </SettingsProviderContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsProviderContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}
