"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardList, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

function BarbellIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <line x1="3" y1="9" x2="3" y2="15" />
      <line x1="6" y1="7" x2="6" y2="17" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="18" y1="7" x2="18" y2="17" />
      <line x1="21" y1="9" x2="21" y2="15" />
    </svg>
  );
}

function TrackIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M7 4.5v15a1 1 0 001.55.83l11-7.5a1 1 0 000-1.66l-11-7.5A1 1 0 007 4.5z" />
    </svg>
  );
}

const navItems = [
  { title: "Home", url: "/", icon: Home, testId: "side-home" },
  { title: "Exercises", url: "/exercises", icon: BarbellIcon, testId: "side-exercises" },
  { title: "Track", url: "/track", icon: TrackIcon, testId: "side-track", isTrack: true },
  { title: "Routines", url: "/routines", icon: ClipboardList, testId: "side-routines" },
  { title: "History", url: "/history", icon: BarChart3, testId: "side-history" },
];

/**
 * Desktop sidebar. Mirrors BottomNav's 5 items and B+ token rules, but vertical
 * and sized for hover targets at md+ breakpoints. Hidden on mobile; BottomNav
 * fills that role. Track uses the same ring/fill treatment as the bottom nav
 * (yellow ring inactive, solid yellow fill active) for visual consistency.
 */
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-20 lg:w-24 flex-col items-center bg-card border-r shadow-inner-hi pt-[calc(env(safe-area-inset-top)+64px)]">
      <nav className="flex flex-col items-center gap-1.5 py-4 w-full">
        {navItems.map((item) => {
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
              data-testid={item.testId}
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
