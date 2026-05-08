"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "@/lib/queryClient";

// /onboarding lives outside the (app) route group so it doesn't inherit the
// full chrome (header/nav). It only needs the React Query client because the
// page uses useMutation to PATCH /api/user-settings.
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
