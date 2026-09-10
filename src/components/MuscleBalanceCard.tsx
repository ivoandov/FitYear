"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ChevronRight, Activity } from "lucide-react";
import type { GroupVerdict } from "@/lib/muscle-balance";
import { clientTimeZone } from "@/lib/date";

interface BalanceResponse {
  baselineDays: number;
  headline: string | null;
  groups: GroupVerdict[];
}

/**
 * "Back and Shoulders are behind."
 *
 * Shown on Home only when there is no active routine, because somebody
 * following a program has already answered the question this card asks, and a
 * coach that second-guesses the plan you just committed to is not helping.
 *
 * Renders NOTHING when nothing is behind. That is deliberate and worth keeping:
 * a card that appears every single day is furniture within a week, and gets
 * skipped on the day it finally has something to say. It also renders nothing
 * while loading or on error - it is a nudge, not information the page owes you,
 * so a spinner here would be noise.
 */
export function MuscleBalanceCard() {
  const router = useRouter();
  const { data } = useQuery<BalanceResponse>({
    queryKey: ["/api/analytics/muscle-balance", clientTimeZone()],
    queryFn: async () => {
      const res = await fetch(
        `/api/analytics/muscle-balance?tz=${encodeURIComponent(clientTimeZone())}`,
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (!data?.headline) return null;

  const behind = data.groups
    .filter((g) => g.status === "behind" || g.status === "never")
    .slice(0, 3);
  if (!behind.length) return null;

  // The generator takes a free-text description, so the nudge hands it one
  // rather than dropping the user on an empty prompt they have to re-type.
  const names = behind.map((g) => g.group);
  const prompt =
    names.length === 1
      ? `A workout focused on ${names[0]}`
      : `A workout covering ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return (
    <button
      type="button"
      onClick={() => router.push(`/fit-bot/workout?prompt=${encodeURIComponent(prompt)}`)}
      data-testid="card-muscle-balance"
      className="card-elevated flex w-full items-start gap-3.5 border-yellow p-4 text-left"
    >
      <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] bg-primary-dim text-primary">
        <Activity className="h-[22px] w-[22px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-tertiary-foreground">
          Worth prioritizing
        </div>
        <div className="mt-1 text-[15px] font-semibold text-foreground" data-testid="text-balance-headline">
          {data.headline}
        </div>
        <ul className="mt-1.5 space-y-0.5">
          {behind.map((g) => (
            <li key={g.group} className="text-[13px] leading-snug text-muted-foreground">
              {g.reason}
            </li>
          ))}
        </ul>
        <div className="mt-2 text-[13px] font-medium text-primary">
          Build a session for {names.length === 1 ? names[0] : "these"}
        </div>
      </div>
      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-tertiary-foreground" />
    </button>
  );
}
