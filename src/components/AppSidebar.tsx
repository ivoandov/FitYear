"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Settings, Loader2, LineChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "@/components/nav-items";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";

/**
 * Desktop icon-rail (md+). Mirrors BottomNav's 5 items and the B+ token rules,
 * but vertical and sized for hover targets. Hidden on mobile; BottomNav fills
 * that role. Per the A+ desktop refresh it also carries the FitYear "F" mark at
 * the top and the account avatar (with the Settings / Log out menu) pinned at
 * the bottom, so account access lives here on desktop instead of a top-bar
 * dropdown. Track uses the same ring/fill treatment as the bottom nav.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout, isLoggingOut } = useAuth();

  // Hide on fullscreen pages (matches AppHeader + BottomNav) so the workout
  // preview + both FitBot flows (single-workout + program-builder wizard) render
  // edge-to-edge as the immersive takeovers they were designed as.
  if (pathname === "/workout-preview" || pathname.startsWith("/fit-bot")) return null;

  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Account";
  const initials =
    [user?.firstName, user?.lastName]
      .filter(Boolean)
      .map((n) => n?.[0])
      .join("") ||
    user?.email?.[0]?.toUpperCase() ||
    "?";

  return (
    <aside className="hidden md:flex fixed left-0 top-0 bottom-0 z-40 w-20 lg:w-24 flex-col items-center bg-card border-r shadow-inner-hi py-[max(1.375rem,env(safe-area-inset-top))]">
      {/* Brand mark */}
      <Link
        href="/"
        aria-label="FitYear home"
        className="mb-6 flex h-10 w-10 items-center justify-center rounded-[11px] bg-primary text-lg font-bold text-primary-foreground"
      >
        F
      </Link>

      <nav className="flex w-full flex-col items-center gap-1.5">
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
              className={cn(
                "flex w-[76px] flex-col items-center justify-center gap-1.5 rounded-[14px] px-2 py-2.5 transition-colors hover:bg-white/[0.03]",
                isActive && !isTrack && "bg-white/[0.04]",
              )}
            >
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
                  showFill && "bg-primary text-primary-foreground",
                  showRing && "border-[1.5px] border-yellow text-foreground",
                  !isTrack && (isActive ? "text-foreground" : "text-muted-foreground"),
                )}
              >
                <item.icon className="h-[22px] w-[22px]" />
              </div>
              <span
                className={cn(
                  "font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.04em]",
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

        {/* Insights lives on the desktop rail only (per design: no 6th bottom-nav
            slot). NAV_ITEMS feeds BOTH navs, so this is hand-added here rather
            than in the shared config; mobile reaches Insights from History. */}
        {(() => {
          const insightsActive = pathname === "/insights";
          return (
            <Link
              href="/insights"
              data-testid="side-insights"
              className={cn(
                "flex w-[76px] flex-col items-center justify-center gap-1.5 rounded-[14px] px-2 py-2.5 transition-colors hover:bg-white/[0.03]",
                insightsActive && "bg-white/[0.04]",
              )}
            >
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full transition-colors",
                  insightsActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <LineChart className="h-[22px] w-[22px]" />
              </div>
              <span
                className={cn(
                  "font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.04em]",
                  insightsActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                Insights
              </span>
            </Link>
          );
        })()}
      </nav>

      {/* Account menu pinned to the bottom */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="mt-auto rounded-full outline-none ring-offset-2 ring-offset-card focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="h-11 w-11 border border-border">
              <AvatarImage
                src={user?.profileImageUrl ?? undefined}
                alt={userName}
                referrerPolicy="no-referrer"
              />
              <AvatarFallback className="bg-input text-sm font-bold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="mb-1">
          <Link href="/settings">
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </Link>
          <DropdownMenuItem onClick={() => logout()} disabled={isLoggingOut}>
            {isLoggingOut ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="mr-2 h-4 w-4" />
            )}
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  );
}
