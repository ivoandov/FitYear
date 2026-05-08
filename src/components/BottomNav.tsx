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
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M6 4v16" />
      <path d="M18 4v16" />
      <path d="M2 8v8" />
      <path d="M22 8v8" />
      <path d="M6 12h12" />
    </svg>
  );
}

const navItems = [
  { title: "Home", url: "/", icon: Home, testId: "nav-home" },
  { title: "Exercises", url: "/exercises", icon: BarbellIcon, testId: "nav-exercises" },
  { title: "Track", url: "/track", icon: TrackIcon, testId: "nav-track", isFab: true },
  { title: "Routines", url: "/routines", icon: ClipboardList, testId: "nav-routines" },
  { title: "History", url: "/history", icon: BarChart3, testId: "nav-history" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map((item) => {
          const isActive =
            pathname === item.url ||
            (item.url === "/" && pathname === "/workouts");

          return (
            <Link
              key={item.url}
              href={item.url}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 w-14 h-14 rounded-full transition-colors",
                item.isFab
                  ? "bg-primary text-primary-foreground"
                  : isActive
                  ? "text-primary"
                  : "text-muted-foreground",
              )}
              data-testid={item.testId}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {item.title}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
