"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { WorkoutProvider } from "@/context/WorkoutContext";
import { TimerProvider } from "@/context/TimerContext";
import { SettingsProvider } from "@/components/SettingsProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SettingsProvider>
          <WorkoutProvider>
            <TimerProvider>{children}</TimerProvider>
          </WorkoutProvider>
        </SettingsProvider>
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
