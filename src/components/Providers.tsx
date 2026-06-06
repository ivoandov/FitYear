"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { WorkoutProvider } from "@/context/WorkoutContext";
import { TimerProvider } from "@/context/TimerContext";
import { SettingsProvider } from "@/components/SettingsProvider";
import { ThemeProvider } from "@/components/ThemeProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {/* ThemeProvider must be present: the Settings page calls useTheme(), and
          without this provider it throws "useTheme must be used within a
          ThemeProvider", crashing the whole page ("this page couldn't load").
          dark-first to match the app's design + the root layout's `dark` class. */}
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <SettingsProvider>
            <WorkoutProvider>
              <TimerProvider>{children}</TimerProvider>
            </WorkoutProvider>
          </SettingsProvider>
        </TooltipProvider>
      </ThemeProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
