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
      // pointer-events-auto + touch-manipulation = ensure Android Chrome doesn't
      // funnel taps to the underlying scroll container. style overrides any inherited
      // pointer-events. inset-x-0 binds left/right reliably on every browser.
      className="fixed bottom-0 inset-x-0 z-[60] bg-background border-t border-border pointer-events-auto touch-manipulation"
      style={{
        pointerEvents: "auto",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <ul className="flex items-end justify-around max-w-lg mx-auto px-1 list-none m-0">
        {navItems.map((item) => {
          const isActive =
            pathname === item.url ||
            (item.url === "/" && pathname === "/workouts");

          return (
            <li key={item.url} className="flex-1">
              <Link
                href={item.url}
                className={cn(
                  "flex flex-col items-center justify-end gap-0.5 py-2 px-1",
                  // Big tap target: at least 56px tall on every nav button
                  "min-h-[56px] cursor-pointer select-none",
                  // Safari iOS: ensure tap highlight is subtle, not invisible
                  "active:opacity-70",
                )}
                style={{ WebkitTapHighlightColor: "rgba(229,255,0,0.18)" }}
                data-testid={item.testId}
                prefetch={false}
              >
                {item.isFab ? (
                  <>
                    <span
                      className="flex h-12 w-12 -translate-y-3 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background"
                      style={{
                        boxShadow:
                          "0 0 18px hsl(66 100% 50% / 0.4), 0 4px 10px rgba(0,0,0,0.3)",
                      }}
                    >
                      <item.icon className="h-5 w-5" />
                    </span>
                    <span
                      className={cn(
                        "text-[10px] -mt-1 font-semibold",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {item.title}
                    </span>
                  </>
                ) : (
                  <>
                    <item.icon
                      className={cn(
                        "h-5 w-5",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {item.title}
                    </span>
                    <span
                      className={cn(
                        "h-1 w-1 rounded-full",
                        isActive ? "bg-primary" : "bg-transparent",
                      )}
                    />
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
