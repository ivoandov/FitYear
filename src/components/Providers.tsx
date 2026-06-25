"use client";

import { useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { WorkoutProvider } from "@/context/WorkoutContext";
import { TimerProvider } from "@/context/TimerContext";
import { SettingsProvider } from "@/components/SettingsProvider";
import { ThemeProvider } from "@/components/ThemeProvider";

// A no-op storage for SSR (window.localStorage is client-only). On the client
// the real localStorage persister restores the query cache so pages paint
// instantly from cache on reopen/reload instead of re-fetching ~374KB.
const noopStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window !== "undefined" ? window.localStorage : noopStorage,
      key: "fy-query-cache",
    }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Drop persisted cache older than 24h, and bust it when the app
        // version changes so a deploy can't serve an incompatible shape.
        maxAge: 24 * 60 * 60 * 1000,
        buster: "v1",
      }}
    >
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
    </PersistQueryClientProvider>
  );
}
