import { consistencySummary, type DayCount } from "@/lib/analytics";

// Sequential single-hue (neon) ramp for the calendar heatmap: 0 = faint track,
// then neon deepening with the day's workout count. One hue = magnitude, on-brand
// and unambiguous (unlike a categorical ramp).
function cellColor(count: number): string {
  if (count <= 0) return "hsla(0,0%,100%,0.05)";
  const alpha = Math.min(1, 0.45 + (Math.min(count, 3) - 1) * 0.275);
  return `hsla(65,100%,50%,${alpha})`;
}

const LEGEND_LEVELS = [0, 1, 2, 3];

// GitHub-style consistency heatmap (weeks x weekdays) + headline stat tiles.
// Days arrive oldest-first from /api/analytics/consistency. Dates are parsed at
// noon to dodge DST edges, and the day-diff is rounded before bucketing so weeks
// stay aligned. weekStart follows the user's setting.
export function ConsistencyPanel({
  days,
  weekStart,
}: {
  days: DayCount[];
  weekStart: "sunday" | "monday";
}) {
  const summary = consistencySummary(days);
  const parse = (iso: string) => new Date(iso + "T12:00:00");
  const weekStartsOn = weekStart === "monday" ? 1 : 0;
  const rowOf = (d: Date) => (d.getDay() - weekStartsOn + 7) % 7;

  const DAY_MS = 86400000;
  let cols = 1;
  const byCell = new Map<string, DayCount>();
  let gridStart: Date | null = null;
  if (days.length > 0) {
    const first = parse(days[0].day);
    gridStart = new Date(first);
    gridStart.setDate(first.getDate() - rowOf(first));
    const colOf = (d: Date) =>
      Math.floor(Math.round((d.getTime() - gridStart!.getTime()) / DAY_MS) / 7);
    for (const dc of days) {
      const d = parse(dc.day);
      byCell.set(`${colOf(d)}-${rowOf(d)}`, dc);
    }
    cols = colOf(parse(days[days.length - 1].day)) + 1;
  }

  // Label all seven rows (Design review 2026-07-16: sparse S/T/T was ambiguous).
  const weekdayLabels = weekStart === "monday"
    ? ["M", "T", "W", "T", "F", "S", "S"]
    : ["S", "M", "T", "W", "T", "F", "S"];

  const tiles = [
    { label: "Week streak", value: String(summary.currentWeekStreak), accent: true },
    { label: "Weeks trained", value: `${summary.weeksTrained}/${summary.totalWeeks}`, accent: false },
    { label: "Active days", value: String(summary.activeDays), accent: false },
    { label: "Workouts", value: String(summary.totalWorkouts), accent: false },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border bg-card p-3 shadow-inner-hi">
            <div
              className={`font-mono text-[24px] font-bold leading-none tabular-nums ${t.accent ? "text-primary" : "text-foreground"}`}
              data-testid={`insight-consistency-${t.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {t.value}
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-tertiary-foreground">
              {t.label}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="flex items-start gap-2" data-testid="insight-heatmap">
          {/* weekday labels */}
          <div className="flex flex-col gap-[3px] pt-[1px]">
            {weekdayLabels.map((l, i) => (
              <div
                key={i}
                className="flex h-[13px] w-3 items-center justify-center font-mono text-[8px] text-tertiary-foreground"
              >
                {l}
              </div>
            ))}
          </div>
          {/* week columns */}
          <div className="flex gap-[3px]">
            {Array.from({ length: cols }, (_, c) => (
              <div key={c} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }, (_, r) => {
                  const dc = byCell.get(`${c}-${r}`);
                  const inRange = !!dc;
                  return (
                    <div
                      key={r}
                      className="h-[13px] w-[13px] rounded-[3px]"
                      style={{
                        backgroundColor: inRange ? cellColor(dc.workouts) : "transparent",
                      }}
                      title={dc ? `${dc.day}: ${dc.workouts} workout${dc.workouts === 1 ? "" : "s"}` : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="flex items-center justify-end gap-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-tertiary-foreground">
        Less
        {LEGEND_LEVELS.map((l) => (
          <span
            key={l}
            className="h-[11px] w-[11px] rounded-[3px]"
            style={{ backgroundColor: cellColor(l) }}
          />
        ))}
        More
      </div>
    </div>
  );
}
