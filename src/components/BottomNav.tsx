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
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t shadow-inner-hi pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch justify-around h-[68px] max-w-lg mx-auto px-2">
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
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2"
              data-testid={`nav-${item.key}`}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-9 h-9 rounded-full transition-colors",
                  showFill && "bg-primary text-primary-foreground",
                  showRing && "border-[1.5px] border-yellow text-foreground",
                  !isTrack && (isActive ? "text-foreground" : "text-muted-foreground"),
                )}
              >
                <item.icon className="h-5 w-5" />
              </div>
              <span
                className={cn(
                  "text-[10px] font-semibold leading-none tracking-wide",
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
      </div>
    </nav>
  );
}
