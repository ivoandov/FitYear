"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/nav-items";

/**
 * Desktop sidebar. Mirrors BottomNav's 5 items and B+ token rules, but vertical
 * and sized for hover targets at md+ breakpoints. Hidden on mobile; BottomNav
 * fills that role. Track uses the same ring/fill treatment as the bottom nav
 * (yellow ring inactive, solid yellow fill active) for visual consistency.
 */
export function AppSidebar() {
  const pathname = usePathname();

  // Hide on fullscreen pages (matches AppHeader + BottomNav) so the workout
  // preview + FitBot single-workout flow render edge-to-edge as the immersive
  // takeovers they were designed as.
  if (pathname === "/workout-preview" || pathname === "/fit-bot/workout") return null;

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-20 lg:w-24 flex-col items-center bg-card border-r shadow-inner-hi pt-[calc(env(safe-area-inset-top)+64px)]">
      <nav className="flex flex-col items-center gap-1.5 py-4 w-full">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.url ||
            (item.url === "/" && pathname === "/workouts");
          const isTrack = item.isTrack === true;
          const showFill = isTrack && isActive;
          const showRing = isTrack && !isActive;

          return (
            <Link
              key={item.url}
              href={item.url}
              data-testid={`side-${item.key}`}
              className="flex flex-col items-center justify-center gap-1.5 w-full px-2 py-2.5 rounded-[12px] hover:bg-white/[0.03] transition-colors"
            >
              <div
                className={cn(
                  "flex items-center justify-center w-11 h-11 rounded-full transition-colors",
                  showFill && "bg-primary text-primary-foreground",
                  showRing && "border-[1.5px] border-yellow text-foreground",
                  !isTrack && (isActive ? "text-foreground" : "text-muted-foreground"),
                )}
              >
                <item.icon className="h-5 w-5" />
              </div>
              <span
                className={cn(
                  "text-[11px] font-semibold leading-none tracking-wide",
                  showFill
                    ? "text-primary"
                    : isActive
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {item.title}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
