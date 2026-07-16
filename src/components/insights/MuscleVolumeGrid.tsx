import { lbsToDisplay, type WeightUnit } from "@/lib/units";
import { Sparkline } from "./Sparkline";

export interface MuscleVolume {
  muscle: string;
  volumeLbs: number[]; // aligned to the shared week axis, zero-filled
  totalLbs: number;
}

// Compact large numbers for the tile headline (e.g. 12,400 -> "12.4k").
function compact(v: number): string {
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(Math.round(v));
}

// Small multiples of training volume per muscle over time, one neon bar
// sparkline per muscle (top N by total volume). Same rationale as the lift grid:
// per-panel magnitude + title-as-identity, so no categorical color ramp and no
// dominant muscle squashing the rest. `weeks` count drives the "avg/wk" caption.
export function MuscleVolumeGrid({
  muscles,
  weeks,
  weightUnit,
  limit = 6,
}: {
  muscles: MuscleVolume[];
  weeks: number;
  weightUnit: WeightUnit;
  limit?: number;
}) {
  const shown = muscles.filter((m) => m.totalLbs > 0).slice(0, limit);
  if (shown.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {shown.map((m) => {
        const totalDisp = lbsToDisplay(m.totalLbs, weightUnit) ?? 0;
        const perWeek = lbsToDisplay(m.totalLbs / Math.max(1, weeks), weightUnit) ?? 0;
        const thisWk = lbsToDisplay(m.volumeLbs[m.volumeLbs.length - 1] ?? 0, weightUnit) ?? 0;
        return (
          <div
            key={m.muscle}
            className="rounded-2xl border bg-card p-3.5 shadow-inner-hi"
            data-testid={`insight-muscle-${m.muscle.toLowerCase()}`}
          >
            <div className="truncate text-[13px] font-semibold text-foreground" title={m.muscle}>
              {m.muscle}
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-[22px] font-bold leading-none tabular-nums text-foreground">
                {compact(totalDisp)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
                {weightUnit} vol
              </span>
            </div>
            <div className="mt-1.5 font-mono text-[11px] tabular-nums text-tertiary-foreground">
              ~{compact(perWeek)} {weightUnit}/wk
              {thisWk > 0 ? (
                <span className="text-foreground"> · {compact(thisWk)} this wk</span>
              ) : null}
            </div>
            <div className="mt-2.5">
              <Sparkline values={m.volumeLbs} variant="bar" height={36} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
