import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { lbsToDisplay, round1, type WeightUnit } from "@/lib/units";
import { Sparkline } from "./Sparkline";

export interface LiftTrend {
  exerciseId: string;
  name: string;
  e1rmLbs: (number | null)[]; // aligned to the shared week axis
}

// Small multiples of estimated-1RM trend, one neon sparkline per top lift. Each
// card headlines the latest est-1RM (Epley) + its change since the window start,
// so identity is the lift name and magnitude is per-panel - no cross-lift color
// coding, no squashed shared axis.
export function LiftTrendGrid({
  lifts,
  weightUnit,
}: {
  lifts: LiftTrend[];
  weightUnit: WeightUnit;
}) {
  if (lifts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {lifts.map((lift) => {
        const present = lift.e1rmLbs.filter(
          (v): v is number => typeof v === "number" && isFinite(v),
        );
        const latest = present.length ? present[present.length - 1] : 0;
        const first = present.length ? present[0] : 0;
        const deltaLbs = round1(latest - first);
        const latestDisp = lbsToDisplay(latest, weightUnit) ?? 0;
        const deltaDisp = round1(
          (lbsToDisplay(Math.abs(deltaLbs), weightUnit) ?? 0) * (deltaLbs < 0 ? -1 : 1),
        );

        return (
          <div
            key={lift.exerciseId}
            className="rounded-2xl border bg-card p-3.5 shadow-inner-hi"
            data-testid={`insight-lift-${lift.exerciseId}`}
          >
            <div className="truncate text-[13px] font-semibold text-foreground" title={lift.name}>
              {lift.name}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-[22px] font-bold leading-none tabular-nums text-foreground">
                {latestDisp}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
                {weightUnit} 1RM
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-1 font-mono text-[11px] tabular-nums">
              {deltaLbs > 0 ? (
                <TrendingUp className="h-3 w-3 text-primary" />
              ) : deltaLbs < 0 ? (
                <TrendingDown className="h-3 w-3 text-tertiary-foreground" />
              ) : (
                <Minus className="h-3 w-3 text-tertiary-foreground" />
              )}
              <span className={deltaLbs > 0 ? "text-primary" : "text-tertiary-foreground"}>
                {deltaLbs > 0 ? "+" : ""}
                {deltaDisp} {weightUnit}
              </span>
              <span className="text-tertiary-foreground">since start</span>
            </div>
            <div className="mt-2.5">
              <Sparkline values={lift.e1rmLbs} variant="line" height={36} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
