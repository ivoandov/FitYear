import { Providers } from "@/components/Providers";
import { BottomNav } from "@/components/BottomNav";
import { AppSidebar } from "@/components/AppSidebar";
import { FloatingTimerPill } from "@/components/FloatingTimerPill";
import { AppHeader } from "@/components/AppHeader";

// Auth gating + onboarding redirect happen in src/proxy.ts using cookies, so
// this layout is intentionally cheap: no getUser(), no DB query, no headers().
// /onboarding lives outside this route group, so we always render the full
// chrome here. force-dynamic skips prerender (some "use client" descendants
// reach into localStorage at module-init and would crash SSR); the per-nav
// cost is negligible because this layout does zero server work.
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex min-h-screen w-full flex-col">
        <AppHeader />
        <AppSidebar />
        <main className="flex flex-1 flex-col overflow-auto pb-20 md:pb-0 md:pl-20 lg:pl-24">
          {children}
        </main>
        <BottomNav />
        <FloatingTimerPill />
      </div>
    </Providers>
  );
}
