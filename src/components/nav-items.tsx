import { Home, ClipboardList, BarChart3 } from "lucide-react";

// Shared nav definition for the two app navs (AppSidebar at md+, BottomNav on
// mobile). Both previously declared these icons + the 5-item array verbatim, so
// any nav change had to be made twice. The consumers keep their own distinct
// layout/markup; only the icons + config live here. Each consumer derives its
// testId from `key` (e.g. `side-home` / `nav-home`).

export function BarbellIcon({ className }: { className?: string }) {
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

export function TrackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M7 4.5v15a1 1 0 001.55.83l11-7.5a1 1 0 000-1.66l-11-7.5A1 1 0 007 4.5z" />
    </svg>
  );
}

export interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  key: string; // testId suffix: `side-<key>` (sidebar) / `nav-<key>` (bottom nav)
  isTrack?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Home", url: "/", icon: Home, key: "home" },
  { title: "Exercises", url: "/exercises", icon: BarbellIcon, key: "exercises" },
  { title: "Track", url: "/track", icon: TrackIcon, key: "track", isTrack: true },
  { title: "Routines", url: "/routines", icon: ClipboardList, key: "routines" },
  { title: "History", url: "/history", icon: BarChart3, key: "history" },
];
