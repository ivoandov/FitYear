"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { TriangleAlert } from "lucide-react";
import { lbsToDisplay, convertWeight, round1 } from "@/lib/units";

export type ProgressPoint = {
  workoutId: string;
  workoutName: string;
  date: string; // YYYY-MM-DD
  bestWeightLbs: number;
  bestVolumeLbs: number;
  best1RMLbs: number;
  sets: Array<{ setIdx: number; weightLbs: number; reps: number }>;
  isOutlier: boolean;
};

type Metric = "1rm" | "heaviest" | "volume";

export function ExerciseProgressChart({
  points,
  weightUnit,
  exerciseId,
  exerciseName,
}: {
  points: ProgressPoint[];
  weightUnit: "lbs" | "kg";
  exerciseId: string;
  exerciseName: string;
}) {
  const [metric, setMetric] = useState<Metric>("1rm");
  const [selected, setSelected] = useState<ProgressPoint | null>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fixing, setFixing] = useState<string | null>(null); // "setIdx" while inflight

  const data = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        value:
          metric === "1rm"
            ? lbsToDisplay(p.best1RMLbs, weightUnit) ?? 0
            : metric === "heaviest"
              ? lbsToDisplay(p.bestWeightLbs, weightUnit) ?? 0
              : lbsToDisplay(p.bestVolumeLbs, weightUnit) ?? 0,
      })),
    [points, metric, weightUnit],
  );

  const metricLabel =
    metric === "1rm"
      ? "Est. 1RM"
      : metric === "heaviest"
        ? "Heaviest set"
        : "Best volume";

  const blurb =
    metric === "1rm"
      ? "Estimated one-rep max via Epley (weight × (1 + reps/30)). Normalizes across rep schemes."
      : metric === "heaviest"
        ? "Heaviest single set weight per workout."
        : "Best set volume (weight × reps) per workout.";

  async function applyKgToLbsFix(point: ProgressPoint, setIdx: number, currentLbs: number) {
    // The stored value is actually kg saved as lbs; treating it as kg and
    // converting to lbs is the correction.
    const newLbs = convertWeight(currentLbs, "kg", "lbs") ?? currentLbs;
    setFixing(String(setIdx));
    try {
      const res = await fetch(
        `/api/completed-workouts/${point.workoutId}/fix-set-weight`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ exerciseId, setIdx, newWeight: newLbs }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        alert(`Fix failed: ${err}`);
        return;
      }
      setSelected(null);
      startTransition(() => router.refresh());
    } finally {
      setFixing(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Progress</h2>
        <div className="inline-flex rounded-[10px] border bg-input p-1 gap-1">
          {(["1rm", "heaviest", "volume"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={`px-3 h-7 rounded-[8px] text-xs font-semibold transition-colors ${
                metric === m
                  ? "bg-white/[0.06] border border-strong text-foreground"
                  : "text-muted-foreground hover:text-foreground border border-transparent"
              }`}
            >
              {m === "1rm" ? "1RM" : m === "heaviest" ? "Heaviest" : "Volume"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-3 shadow-inner-hi">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsla(0,0%,100%,0.06)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "hsla(0,0%,100%,0.5)" }}
              tickMargin={6}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsla(0,0%,100%,0.5)" }}
              width={42}
            />
            <Tooltip content={<ChartTooltip unit={weightUnit} metricLabel={metricLabel} />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="hsl(65,100%,50%)"
              strokeWidth={2}
              isAnimationActive={false}
              dot={(dotProps: unknown) => (
                <OutlierDot
                  {...(dotProps as { cx: number; cy: number; payload: ProgressPoint })}
                  onClick={(p) => setSelected(p)}
                />
              )}
              activeDot={{ r: 6, fill: "hsl(65,100%,50%)" }}
            />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-xs text-muted-foreground mt-2 px-1">
          {blurb} Red rings = anomalies (&lt;50% of median). Tap a point for details.
        </p>
      </div>

      <Sheet
        open={!!selected}
        onOpenChange={(o: boolean) => !o && setSelected(null)}
      >
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.workoutName}</SheetTitle>
                <SheetDescription>
                  {new Date(selected.date).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  {selected.isOutlier ? (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-destructive/20 text-destructive">
                      <TriangleAlert className="h-3 w-3" />
                      Anomaly
                    </span>
                  ) : null}
                </SheetDescription>
              </SheetHeader>
              <div className="px-6 py-4 space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">
                  {exerciseName} — completed sets
                </h3>
                <div className="space-y-2">
                  {selected.sets.map((s) => {
                    const display = lbsToDisplay(s.weightLbs, weightUnit) ?? 0;
                    // Preview of the kg->lbs correction in the user's unit.
                    const fixedLbs = convertWeight(s.weightLbs, "kg", "lbs") ?? 0;
                    const fixedDisplay = lbsToDisplay(fixedLbs, weightUnit) ?? 0;
                    return (
                      <div
                        key={s.setIdx}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-input px-3 py-2"
                      >
                        <div className="text-sm">
                          Set {s.setIdx + 1}:{" "}
                          <span className="font-semibold tabular-nums">
                            {display} {weightUnit}
                          </span>{" "}
                          × {s.reps}
                        </div>
                        {selected.isOutlier ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              applyKgToLbsFix(selected, s.setIdx, s.weightLbs)
                            }
                            disabled={
                              isPending || fixing === String(s.setIdx)
                            }
                          >
                            {fixing === String(s.setIdx)
                              ? "Fixing…"
                              : `Treat as kg → ${fixedDisplay} ${weightUnit}`}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {selected.isOutlier ? (
                  <p className="text-xs text-muted-foreground">
                    "Treat as kg" multiplies the stored weight by 2.20462. Use when this workout
                    was logged in kg but the value was stored without conversion.
                  </p>
                ) : null}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function OutlierDot({
  cx,
  cy,
  payload,
  onClick,
}: {
  cx: number;
  cy: number;
  payload: ProgressPoint;
  onClick: (p: ProgressPoint) => void;
}) {
  const o = payload?.isOutlier;
  return (
    <g style={{ cursor: "pointer" }} onClick={() => onClick(payload)}>
      {o ? (
        <circle
          cx={cx}
          cy={cy}
          r={9}
          fill="none"
          stroke="hsl(0,75%,60%)"
          strokeWidth={1.5}
          opacity={0.7}
        />
      ) : null}
      <circle
        cx={cx}
        cy={cy}
        r={o ? 5 : 3}
        fill={o ? "hsl(0,75%,60%)" : "hsl(65,100%,50%)"}
      />
    </g>
  );
}

function ChartTooltip({
  active,
  payload,
  unit,
  metricLabel,
}: {
  active?: boolean;
  payload?: Array<{ payload: ProgressPoint & { value: number } }>;
  unit: "lbs" | "kg";
  metricLabel: string;
}) {
  if (!active || !payload || !payload[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 shadow-lg text-xs space-y-0.5">
      <div className="font-semibold">{p.workoutName}</div>
      <div className="text-muted-foreground">
        {new Date(p.date).toLocaleDateString()}
      </div>
      <div className="tabular-nums">
        {metricLabel}: <span className="font-semibold">{round1(p.value)} {unit}</span>
      </div>
      {p.isOutlier ? (
        <div className="text-destructive flex items-center gap-1">
          <TriangleAlert className="h-3 w-3" />
          Anomaly — tap to inspect
        </div>
      ) : null}
    </div>
  );
}
