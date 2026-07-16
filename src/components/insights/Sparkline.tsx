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
    // Scale to the trained (positive) weeks' own min->max, not a zero baseline:
    // a zero-based axis flattens genuinely-steady volume into a uniform barcode
    // with no signal. Untrained (0) weeks render nothing. A floor keeps the
    // smallest trained week visible, and the LATEST week is full-neon while
    // prior weeks drop to 0.4 alpha so "trending up vs. coasting" reads instantly.
    const pos = nums.filter((v) => v > 0);
    const bMax = Math.max(...pos);
    const bMin = Math.min(...pos);
    const bSpan = bMax - bMin || 1;
    const FLOOR = 0.22; // smallest trained bar as a fraction of full height
    const innerH = H - 2 * PAD;
    const single = pos.length === 1;
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
          if (val <= 0) return null;
          const frac = single ? 1 : FLOOR + ((val - bMin) / bSpan) * (1 - FLOOR);
          const barH = frac * innerH;
          const top = H - PAD - barH;
          const cx = x(i) - bw / 2;
          const isLatest = i === n - 1;
          return (
            <rect
              key={i}
              x={Math.max(0, cx)}
              y={top}
              width={bw}
              height={Math.max(0, barH)}
              rx={0.8}
              fill={NEON}
              fillOpacity={isLatest ? 1 : 0.4}
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
