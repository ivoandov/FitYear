"use client";

import { useState, type PointerEvent } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { lbsToDisplay, round1, type WeightUnit } from "@/lib/units";
import { Sparkline } from "./Sparkline";

export interface LiftTrend {
  exerciseId: string;
  name: string;
  e1rmLbs: (number | null)[]; // aligned to the shared week axis
}

const NEON = "hsl(65,100%,50%)";
// Plot geometry (viewBox units). X_L leaves a left gutter for the y-axis labels.
const VB_W = 300;
const VB_H = 74;
const X_L = 30;
const X_R = 294;
const Y_T = 6;
const Y_B = 68;

// "2026-07-14" -> "Jul 14" (parsed as a local date to avoid a TZ day-shift).
function formatWeek(iso: string | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Small multiples of estimated-1RM trend, one neon sparkline per top lift. Each
// card headlines the latest est-1RM (Epley) + its change since the window start,
// so identity is the lift name and magnitude is per-panel - no cross-lift color
// coding, no squashed shared axis. Design review 2026-07-16: keep the area fill,
// add faint local-range Y-axis references + a hover crosshair that reads out the
// exact 1RM + week and swaps the headline value to the hovered point (works on
// touch-drag). 2-up on desktop so the larger sparklines read the trend clearly.
export function LiftTrendGrid({
  lifts,
  weeks,
  weightUnit,
}: {
  lifts: LiftTrend[];
  weeks: string[];
  weightUnit: WeightUnit;
}) {
  if (lifts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {lifts.map((lift) => (
        <LiftTrendCard
          key={lift.exerciseId}
          lift={lift}
          weeks={weeks}
          weightUnit={weightUnit}
        />
      ))}
    </div>
  );
}

function LiftTrendCard({
  lift,
  weeks,
  weightUnit,
}: {
  lift: LiftTrend;
  weeks: string[];
  weightUnit: WeightUnit;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = lift.e1rmLbs.length;
  const present = lift.e1rmLbs
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => typeof p.v === "number" && isFinite(p.v));

  const latestVal = present.length ? present[present.length - 1].v : 0;
  const firstVal = present.length ? present[0].v : 0;
  const deltaLbs = round1(latestVal - firstVal);
  const deltaDisp = round1(
    (lbsToDisplay(Math.abs(deltaLbs), weightUnit) ?? 0) * (deltaLbs < 0 ? -1 : 1),
  );

  const interactive = present.length >= 2;

  // Per-panel min->max scale over the present points (own y-scale per lift).
  const vals = present.map((p) => p.v);
  const minLbs = interactive ? Math.min(...vals) : 0;
  const maxLbs = interactive ? Math.max(...vals) : 1;
  const span = maxLbs - minLbs || 1;
  const px = (i: number) => X_L + ((X_R - X_L) * i) / (n - 1);
  const py = (v: number) => Y_B - ((v - minLbs) / span) * (Y_B - Y_T);

  const linePts = present.map((p) => `${px(p.i).toFixed(1)},${py(p.v).toFixed(1)}`).join(" ");
  const areaPts = `${linePts} ${px(present[present.length - 1]?.i ?? 0).toFixed(1)},${Y_B + 4} ${px(present[0]?.i ?? 0).toFixed(1)},${Y_B + 4}`;

  // Three faint reference lines at the panel's own max / mid / min, labelled in
  // display units and overlaid as crisp HTML (not stretched SVG text).
  const gridLines = [maxLbs, (minLbs + maxLbs) / 2, minLbs].map((v) => {
    const gy = py(v);
    return {
      y: gy,
      labelTop: `${((gy / VB_H) * 100).toFixed(1)}%`,
      label: String(Math.round(lbsToDisplay(v, weightUnit) ?? 0)),
    };
  });

  // Pointer -> nearest PRESENT index (real data has null-gap weeks; the crosshair
  // must land on an actual point). Same index-from-pointer math as the mock.
  const snapToPresent = (raw: number) => {
    let best = present[0].i;
    let bestD = Infinity;
    for (const p of present) {
      const d = Math.abs(p.i - raw);
      if (d < bestD) {
        bestD = d;
        best = p.i;
      }
    }
    return best;
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    let f = (e.clientX - rect.left) / rect.width;
    f = Math.max(0, Math.min(1, f));
    setHoverIdx(snapToPresent(Math.round(f * (n - 1))));
  };

  const activeIdx =
    hoverIdx != null ? hoverIdx : present.length ? present[present.length - 1].i : n - 1;
  const hovering = hoverIdx != null;
  const headVal = lift.e1rmLbs[activeIdx] ?? latestVal;
  const headDisp = lbsToDisplay(headVal, weightUnit) ?? 0;
  const hoverX = px(activeIdx);
  const hoverF = hoverX / VB_W;
  const tooltipTransform =
    hoverF < 0.16 ? "translateX(0)" : hoverF > 0.84 ? "translateX(-100%)" : "translateX(-50%)";

  return (
    <div
      className="rounded-2xl border bg-card p-3.5 shadow-inner-hi"
      data-testid={`insight-lift-${lift.exerciseId}`}
    >
      <div className="truncate text-[13px] font-semibold text-foreground" title={lift.name}>
        {lift.name}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-mono text-[22px] font-bold leading-none tabular-nums text-foreground"
          data-testid={`lift-headline-${lift.exerciseId}`}
        >
          {headDisp}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
          {hovering ? `${weightUnit} · ${formatWeek(weeks[activeIdx])}` : `${weightUnit} 1RM`}
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

      {interactive ? (
        <div
          className="relative mt-2.5 touch-none"
          style={{ cursor: "crosshair" }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHoverIdx(null)}
          onPointerCancel={() => setHoverIdx(null)}
        >
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            width="100%"
            height={40}
            preserveAspectRatio="none"
            role="img"
            className="block"
          >
            {gridLines.map((g, i) => (
              <line
                key={i}
                x1={X_L}
                x2={X_R}
                y1={g.y}
                y2={g.y}
                stroke="hsla(0,0%,100%,0.09)"
                strokeWidth={1}
              />
            ))}
            <polygon points={areaPts} fill="hsla(65,100%,50%,0.10)" />
            <polyline
              points={linePts}
              fill="none"
              stroke={NEON}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {hovering ? (
              <>
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={Y_T - 2}
                  y2={Y_B + 2}
                  stroke={NEON}
                  strokeOpacity={0.45}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
                <circle cx={hoverX} cy={py(headVal)} r={3.2} fill={NEON} />
              </>
            ) : null}
          </svg>
          {/* y-axis labels (crisp HTML, not stretched SVG text) */}
          {gridLines.map((g, i) => (
            <span
              key={i}
              className="pointer-events-none absolute left-0 -translate-y-1/2 font-mono text-[9px] tabular-nums text-tertiary-foreground"
              style={{ top: g.labelTop }}
            >
              {g.label}
            </span>
          ))}
          {/* hover tooltip */}
          {hovering ? (
            <div
              className="pointer-events-none absolute -top-1.5 whitespace-nowrap rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10px] tabular-nums shadow-lg"
              style={{ left: `${(hoverF * 100).toFixed(1)}%`, transform: tooltipTransform }}
            >
              <span className="font-bold text-primary">{headDisp}</span>
              <span className="text-tertiary-foreground"> {weightUnit} · {formatWeek(weeks[activeIdx])}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2.5">
          <Sparkline values={lift.e1rmLbs} variant="line" height={36} />
        </div>
      )}
    </div>
  );
}
