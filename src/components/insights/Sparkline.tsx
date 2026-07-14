// A tiny monochrome sparkline (inline SVG, no chart lib) for the Insights
// small-multiples. Each panel is its OWN mini chart with its OWN y-scale, so
// lifts/muscles of wildly different magnitudes each read clearly - the reason we
// use small multiples instead of one shared-axis multi-series chart. Neon on the
// B+ dark surface; identity comes from the panel title, never from color, so no
// categorical palette is needed. `line` scales to [min,max] for trend
// resolution; `bar` baselines at 0. Nulls (weeks with no session) are gaps the
// line bridges. Stroke stays 2px at any width via non-scaling-stroke.
const NEON = "hsl(65,100%,50%)";

export function Sparkline({
  values,
  variant = "line",
  height = 34,
  className,
}: {
  values: (number | null)[];
  variant?: "line" | "bar";
  height?: number;
  className?: string;
}) {
  const W = 100;
  const H = height;
  const PAD = 3;
  const n = values.length;
  const nums = values.filter(
    (v): v is number => typeof v === "number" && isFinite(v),
  );
  const hasData = nums.length > 0 && nums.some((v) => v > 0);

  if (n === 0 || !hasData) {
    return (
      <div
        className={className}
        style={{ height: H }}
        aria-hidden
      />
    );
  }

  const max = Math.max(...nums);
  const min = variant === "bar" ? 0 : Math.min(...nums);
  const span = max - min || 1;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

  if (variant === "bar") {
    const slot = W / n;
    const bw = Math.max(1.5, slot * 0.6);
    return (
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        className={className}
        role="img"
      >
        {values.map((v, i) => {
          const val = typeof v === "number" && isFinite(v) ? v : 0;
          const top = val > 0 ? y(val) : H - PAD;
          const cx = x(i) - bw / 2;
          return (
            <rect
              key={i}
              x={Math.max(0, cx)}
              y={top}
              width={bw}
              height={Math.max(0, H - PAD - top)}
              rx={0.8}
              fill={val > 0 ? NEON : "hsla(0,0%,100%,0.08)"}
            />
          );
        })}
      </svg>
    );
  }

  // line: a polyline through the present points (bridging null gaps), plus a
  // faint neon area under it.
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => typeof p.v === "number" && isFinite(p.v));
  const line = present.map((p) => `${x(p.i)},${y(p.v)}`).join(" ");
  const area =
    present.length > 1
      ? `${x(present[0].i)},${H - PAD} ${line} ${x(present[present.length - 1].i)},${H - PAD}`
      : "";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
      className={className}
      role="img"
    >
      {area ? <polygon points={area} fill="hsla(65,100%,50%,0.10)" /> : null}
      <polyline
        points={line}
        fill="none"
        stroke={NEON}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {present.length === 1 ? (
        <circle cx={x(present[0].i)} cy={y(present[0].v)} r={2.5} fill={NEON} />
      ) : null}
    </svg>
  );
}
