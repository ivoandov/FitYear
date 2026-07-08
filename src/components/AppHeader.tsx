"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, MoreVertical, Settings, Loader2 } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";

export function AppHeader() {
  const pathname = usePathname();
  const { user, logout, isLoggingOut } = useAuth();

  // Hide header on fullscreen takeovers: workout preview + all FitBot flows
  // (single-workout /fit-bot/workout AND the program-builder wizard /fit-bot).
  if (pathname === "/workout-preview" || pathname.startsWith("/fit-bot")) return null;

  const isHome = pathname === "/" || pathname === "/workouts";
  const userName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "User";
  const initials =
    [user?.firstName, user?.lastName]
      .filter(Boolean)
      .map((n) => n?.[0])
      .join("") ||
    user?.email?.[0]?.toUpperCase() ||
    "?";

  const title = (() => {
    switch (pathname) {
      case "/":
      case "/workouts":
        return "Fit Year";
      case "/track":
        return "Track";
      case "/exercises":
        return "Exercises";
      case "/routines":
        return "Routines";
      case "/history":
        return "History";
      case "/settings":
        return "Settings";
      default:
        return "Fit Year";
    }
  })();

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-background">
      {isHome && user ? (
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={user.profileImageUrl ?? undefined} alt={userName} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm text-muted-foreground">Welcome Back,</p>
            <p className="text-2xl font-bold text-primary">{userName}.</p>
          </div>
        </div>
      ) : (
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="User menu">
            <MoreVertical className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
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
    </header>
  );
}
