"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardList, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  testId: string;
  isFab?: boolean;
}

// Custom barbell icon — side-view, two plates per side. Avoids the head-circle
// clash with the active-tab dot indicator that the legacy GiWeightLiftingUp
// caused.
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

const navItems: NavItem[] = [
  { title: "Home", url: "/", icon: Home, testId: "nav-home" },
  { title: "Exercises", url: "/exercises", icon: BarbellIcon, testId: "nav-exercises" },
  { title: "Track", url: "/track", icon: TrackIcon, testId: "nav-track", isFab: true },
  { title: "Routines", url: "/routines", icon: ClipboardList, testId: "nav-routines" },
  { title: "History", url: "/history", icon: BarChart3, testId: "nav-history" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-end justify-around h-16 max-w-lg mx-auto px-2 pt-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.url ||
            (item.url === "/" && pathname === "/workouts");

          if (item.isFab) {
            // Track FAB — elevated above the bar, neon fill, glow
            return (
              <Link
                key={item.url}
                href={item.url}
                className="relative flex flex-col items-center justify-end gap-1"
                data-testid={item.testId}
              >
                <div
                  className={cn(
                    "flex h-14 w-14 -translate-y-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform",
                    "hover:scale-105 active:scale-95",
                  )}
                  style={{ boxShadow: "0 0 20px hsl(var(--primary) / 0.4), 0 4px 12px rgba(0,0,0,0.3)" }}
                >
                  <item.icon className="h-6 w-6" />
                </div>
                <span
                  className={cn(
                    "text-[10px] -mt-2 font-semibold transition-colors",
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
              className="flex flex-col items-center justify-end gap-0.5 px-2 py-1"
              data-testid={item.testId}
            >
              <item.icon
                className={cn(
                  "h-5 w-5 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-[10px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                {item.title}
              </span>
              {/* Active-tab indicator: small dot, NOT a filled circle (which is
                  reserved for the Track FAB) */}
              {isActive ? (
                <div className="h-1 w-1 rounded-full bg-primary" />
              ) : (
                <div className="h-1 w-1" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
