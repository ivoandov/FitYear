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
  { title: "Home", url: "/", icon: Home, testId: "nav-home" },
  { title: "Exercises", url: "/exercises", icon: BarbellIcon, testId: "nav-exercises" },
  { title: "Track", url: "/track", icon: TrackIcon, testId: "nav-track", isTrack: true },
  { title: "Routines", url: "/routines", icon: ClipboardList, testId: "nav-routines" },
  { title: "History", url: "/history", icon: BarChart3, testId: "nav-history" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t shadow-inner-hi pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch justify-around h-[68px] max-w-lg mx-auto px-2">
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
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2"
              data-testid={item.testId}
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
