"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { lbsToDisplay, round1 } from "@/lib/units";

export interface VolumePoint {
  weekStart: string; // "YYYY-MM-DD" (Monday of the week)
  volumeLbs: number;
  sets: number;
  workouts: number;
}

// Weekly total-volume bars for the History dashboard. Volume comes from the SQL
// endpoint in lbs; convert to the user's unit here. Empty weeks render a faint
// placeholder bar so the trend reads as a continuous timeline.
export function VolumeTrendChart({
  data,
  weightUnit,
}: {
  data: VolumePoint[];
  weightUnit: "lbs" | "kg";
}) {
  const rows = data.map((d) => ({
    ...d,
    label: formatWeek(d.weekStart),
    value: lbsToDisplay(d.volumeLbs, weightUnit) ?? 0,
  }));
  const hasAny = rows.some((r) => r.value > 0);

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="hsla(0,0%,100%,0.06)"
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "hsla(0,0%,100%,0.5)" }}
            tickMargin={6}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsla(0,0%,100%,0.5)" }}
            width={44}
            tickFormatter={compact}
          />
          <Tooltip
            content={<VolTooltip unit={weightUnit} />}
            cursor={{ fill: "hsla(0,0%,100%,0.04)" }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {rows.map((r, i) => (
              <Cell
                key={i}
                fill={r.value > 0 ? "hsl(65,100%,50%)" : "hsla(0,0%,100%,0.08)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {!hasAny ? (
        <p className="mt-1 text-center text-xs text-tertiary-foreground">
          No volume logged in this window yet.
        </p>
      ) : null}
    </div>
  );
}

function formatWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function compact(v: number): string {
  if (v >= 1000) return `${round1(v / 1000)}k`;
  return String(Math.round(v));
}

function VolTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload: VolumePoint & { value: number; label: string } }>;
  unit: string;
}) {
  if (!active || !payload || !payload[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-lg text-xs space-y-0.5">
      <div className="font-semibold">Week of {p.label}</div>
      <div className="tabular-nums">
        Volume:{" "}
        <span className="font-semibold">
          {Math.round(p.value).toLocaleString()} {unit}
        </span>
      </div>
      <div className="text-muted-foreground tabular-nums">
        {p.sets} {p.sets === 1 ? "set" : "sets"} · {p.workouts}{" "}
        {p.workouts === 1 ? "workout" : "workouts"}
      </div>
    </div>
  );
}
