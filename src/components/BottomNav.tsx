"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/nav-items";

export function BottomNav() {
  const pathname = usePathname();

  // Hide on fullscreen pages (matches AppHeader). The workout preview + both
  // FitBot flows (single-workout + program-builder wizard) are immersive
  // takeovers with their own fixed bottom CTAs; this z-50 nav would otherwise
  // render on top of and obscure those buttons on mobile.
  if (pathname === "/workout-preview" || pathname.startsWith("/fit-bot")) return null;

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-divider bg-card/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex h-20 max-w-lg items-start justify-around px-2.5 pt-3">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.url ||
            (item.url === "/" && pathname === "/workouts");

          // Track is a raised circular neon FAB centered in the bar.
          if (item.isTrack) {
            return (
              <Link
                key={item.url}
                href={item.url}
                className="flex flex-1 flex-col items-center gap-1.5"
                data-testid={`nav-${item.key}`}
              >
                <div className="-mt-[18px] flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-primary-foreground shadow-[0_8px_22px_-4px_rgba(229,255,0,0.5)]">
                  <item.icon className="h-[22px] w-[22px]" />
                </div>
                <span
                  className={cn(
                    "font-mono text-[9px] font-bold uppercase tracking-[0.08em]",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {item.title}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.url}
              href={item.url}
              className="flex flex-1 flex-col items-center gap-1.5"
              data-testid={`nav-${item.key}`}
            >
              <item.icon
                className={cn(
                  "h-[21px] w-[21px] transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "font-mono text-[9px] font-semibold uppercase tracking-[0.08em]",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {item.title}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
