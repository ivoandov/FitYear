/**
 * Date bucketing — one convention: **local-day** ("what day is this workout
 * on" from the viewer's wall clock, matching calcStreak and user intuition).
 *
 * Before this module there were three conventions in the wild: local getters
 * (calcStreak), a UTC slice (`toISOString().slice(0,10)` on the progress chart,
 * which bucketed an 8pm-local workout into the next UTC day so the chart and
 * streak disagreed), ~15 hand-rolled `${getFullYear()}-...` template strings,
 * and fragile ISO string-sniffing. Everything now routes through here.
 *
 * NOTE: the per-user AI quota (lib/api/rate-limit.ts) deliberately buckets by
 * UTC day and does NOT use this module.
 */

/**
 * Robustly parse a server-provided timestamp string into a Date.
 *
 * The DB stores `timestamp without time zone` and the API serializes it without
 * an offset, so a string with no timezone marker is treated as UTC (append Z).
 * Strings that already carry a `Z` / `+hh:mm` / `-hh:mm` offset are parsed
 * as-is. (Replaces the inline sniffing that used to live in WorkoutContext.)
 */
export function parseServerDate(iso: string | Date): Date {
  if (iso instanceof Date) return iso;
  const noTz =
    !iso.includes("Z") && !iso.includes("+") && !iso.includes("-", 10);
  return new Date(noTz ? iso + "Z" : iso);
}

/**
 * "YYYY-MM-DD" from LOCAL getters — the app-wide day key. Accepts a Date or a
 * server timestamp string (parsed via parseServerDate first).
 */
export function localDateKey(d: Date | string): string {
  const date = typeof d === "string" ? parseServerDate(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
