"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Dumbbell, Flame } from "lucide-react";
import { DesktopTopBar } from "@/components/DesktopTopBar";
import { useSettings } from "@/components/SettingsProvider";
import { LiftTrendGrid, type LiftTrend } from "@/components/insights/LiftTrendGrid";
import { MuscleVolumeGrid, type MuscleVolume } from "@/components/insights/MuscleVolumeGrid";
import { ConsistencyPanel } from "@/components/insights/ConsistencyPanel";
import type { DayCount } from "@/lib/analytics";
import type { WeightUnit } from "@/lib/units";
import type { ReactNode } from "react";

interface E1rmTrend {
  weeks: string[];
  lifts: LiftTrend[];
}
interface MuscleVolumeTrend {
  weeks: string[];
  muscles: MuscleVolume[];
}

export default function InsightsPage() {
  const { weekStart } = useSettings();

  const { data: settings } = useQuery<{ weightUnit?: WeightUnit }>({
    queryKey: ["/api/user-settings"],
  });
  const weightUnit: WeightUnit = settings?.weightUnit ?? "lbs";

  const { data: e1rm, isPending: e1rmLoading } = useQuery<E1rmTrend>({
    queryKey: ["/api/analytics/est-1rm-trend"],
  });
  const { data: muscle, isPending: muscleLoading } = useQuery<MuscleVolumeTrend>({
    queryKey: ["/api/analytics/muscle-volume-trend"],
  });
  const { data: consistency = [], isPending: consistencyLoading } = useQuery<DayCount[]>({
    queryKey: ["/api/analytics/consistency"],
  });

  const lifts = e1rm?.lifts ?? [];
  const liftWeeks = e1rm?.weeks ?? [];
  const muscles = muscle?.muscles ?? [];
  const muscleWeeks = muscle?.weeks.length ?? 12;
  const hasAnything =
    lifts.length > 0 || muscles.some((m) => m.totalLbs > 0) || consistency.some((d) => d.workouts > 0);
  const stillLoading = e1rmLoading || muscleLoading || consistencyLoading;

  return (
    <div className="flex-1 overflow-auto h-full">
      <DesktopTopBar title="Insights" />
      <div className="mx-auto w-full max-w-2xl px-5 py-6 pb-12 space-y-5 md:max-w-6xl md:px-9 md:pt-7">
        {/* Title (mobile only; desktop shows it in the top bar) */}
        <div className="md:hidden">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]" data-testid="text-page-title">
            Insights
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your training, across every lift
          </p>
        </div>

        {!stillLoading && !hasAnything ? (
          <div className="card-elevated flex flex-col items-center p-10 text-center">
            <TrendingUp className="mb-4 h-10 w-10 text-tertiary-foreground" />
            <h3 className="text-base font-bold">No insights yet</h3>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Log a few workouts and your strength trends, volume by muscle, and consistency will show up here.
            </p>
          </div>
        ) : (
          <>
            <Section
              icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />}
              title="Strength trend · top lifts"
              subtitle={`Estimated 1RM over the last 12 weeks (${weightUnit})`}
            >
              {e1rmLoading ? (
                <GridSkeleton />
              ) : lifts.length > 0 ? (
                <LiftTrendGrid lifts={lifts} weeks={liftWeeks} weightUnit={weightUnit} />
              ) : (
                <Empty>Log a couple of weighted lifts to see strength trends.</Empty>
              )}
            </Section>

            <Section
              icon={<Dumbbell className="h-3.5 w-3.5 text-primary" />}
              title="Volume by muscle"
              subtitle={`Weight moved per muscle over the last 12 weeks (${weightUnit})`}
            >
              {muscleLoading ? (
                <GridSkeleton />
              ) : muscles.some((m) => m.totalLbs > 0) ? (
                <MuscleVolumeGrid muscles={muscles} weeks={muscleWeeks} weightUnit={weightUnit} />
              ) : (
                <Empty>No muscle volume logged in this window yet.</Empty>
              )}
            </Section>

            <Section
              icon={<Flame className="h-3.5 w-3.5 text-primary" />}
              title="Consistency"
              subtitle="Your training rhythm over the last 12 weeks"
            >
              {consistencyLoading ? (
                <div className="h-40 animate-pulse rounded-xl bg-white/[0.04]" />
              ) : (
                <ConsistencyPanel days={consistency} weekStart={weekStart} />
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="card-elevated p-5">
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-1 text-xs text-tertiary-foreground">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[120px] animate-pulse rounded-2xl bg-white/[0.04]" />
      ))}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-tertiary-foreground">{children}</p>;
}
