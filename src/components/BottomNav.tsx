"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ClipboardList, BarChart3, Dumbbell } from "lucide-react";
import { GiWeightLiftingUp } from "react-icons/gi";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Home", url: "/", icon: Home, testId: "nav-home" },
  { title: "Track", url: "/track", icon: Dumbbell, testId: "nav-track" },
  {
    title: "Exercises",
    url: "/exercises",
    icon: GiWeightLiftingUp,
    testId: "nav-exercises",
  },
  {
    title: "Routines",
    url: "/routines",
    icon: ClipboardList,
    testId: "nav-routines",
  },
  { title: "History", url: "/history", icon: BarChart3, testId: "nav-history" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background">
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
                "flex flex-col items-center justify-center w-14 h-14 rounded-full transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={item.testId}
            >
              <item.icon className="h-5 w-5" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
