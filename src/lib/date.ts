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
/**
 * The viewer's IANA zone, for analytics endpoints that bucket by day/week. The
 * server stores completed_at as UTC wall clock, so without this the SQL buckets
 * on UTC days while every client-side date calc uses local days - which put
 * roughly half of an evening trainer's sessions on the wrong heatmap day.
 */
export function clientTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Local-day key in an EXPLICIT IANA zone.
 *
 * `localDateKey` uses the runtime's own clock, which is correct in the browser
 * and wrong in a server component: on Vercel the server is UTC, so an evening
 * workout bucketed into the next day and the server-rendered streak and
 * progress chart disagreed with every client surface. Server code must pass the
 * viewer's zone (see `viewerTimeZone` in lib/server-timezone.ts).
 */
export function localDateKeyInZone(d: Date | string, timeZone: string): string {
  const date = typeof d === "string" ? parseServerDate(d) : d;
  try {
    // en-CA renders as YYYY-MM-DD, which is exactly the key format.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return localDateKey(date);
  }
}

export function localDateKey(d: Date | string): string {
  const date = typeof d === "string" ? parseServerDate(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
