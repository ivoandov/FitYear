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

/**
 * The UTC instant at which the CURRENT local day began in `timeZone`.
 *
 * Exists because filtering "upcoming" by `date >= now()` silently drops the
 * session due TODAY the moment its start time passes. Ivo's Day 1 was stored
 * at 14:00Z (07:00 in Los Angeles), so at 09:50 local it had already fallen out
 * of the payload and Liv reported "nothing scheduled today" on the very day the
 * program began. A schedule is a thing people read by DAY, not by instant.
 *
 * Computed from the zone's own offset rather than by assuming a fixed one, and
 * corrected once so a DST transition inside the day cannot shift it an hour.
 */
export function startOfLocalDayUtc(at: Date, timeZone: string): Date {
  const key = localDateKeyInZone(at, timeZone);
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return at;

  // Offset the zone was at, for a given instant.
  const offsetMs = (instant: Date): number => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(instant);
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const asUtc = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour") % 24,
        get("minute"),
        get("second"),
      );
      return asUtc - instant.getTime();
    } catch {
      return 0;
    }
  };

  // Treat local midnight as if it were UTC, then step back by the offset that
  // actually applies there. One correction pass settles a DST boundary.
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const first = offsetMs(new Date(guess));
  guess -= first;
  const second = offsetMs(new Date(guess));
  if (second !== first) guess += first - second;
  return new Date(guess);
}

/**
 * A scheduled workout is a DAY, not a moment, and it must survive being read
 * from a different timezone than the one it was created in.
 *
 * Storing local midnight does not survive that: midnight in Los Angeles is
 * 07:00Z, which any zone WEST of Los Angeles reads as the previous day. That is
 * exactly what happened - Day 1 of Ivo's program resolved to the 26th in
 * Honolulu while resolving correctly everywhere east of him.
 *
 * NOON UTC is the safe anchor, and is already the convention the manual
 * scheduling route uses ("timezone-safe storage").
 *
 * Noon is chosen so that even code which WRONGLY resolves the instant in a
 * local zone still gets the right day across UTC-12..UTC+11. That is a safety
 * net, not the contract: read the day back with `scheduledDateKey`, which is
 * exact in every zone including UTC+12 and beyond.
 */
export function scheduledDateFromKey(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

/**
 * Recovers the authored day from a stored scheduled date. The EXACT inverse of
 * `scheduledDateFromKey`, and the only correct way to read one back.
 *
 * A scheduled workout is a day someone CHOSE, not a moment that happened, so it
 * must read the same everywhere - a session Ivo put on the 27th is on the 27th
 * whether he opens the app in Los Angeles or Auckland. Resolving the stored
 * instant in the viewer's zone re-interprets it instead, and noon UTC lands on
 * the NEXT local day from UTC+12 east: Auckland, Fiji, Chatham, Kiritimati. New
 * Zealand is not an edge case, and that bug shipped in the Liv payload.
 *
 * Because the anchor is ours, the UTC date part IS the key that was written, so
 * no zone enters the read at all.
 */
export function scheduledDateKey(d: Date | string): string {
  const at = typeof d === "string" ? parseServerDate(d) : d;
  return at.toISOString().slice(0, 10);
}

/** Add whole days to a YYYY-MM-DD key without touching timezones at all. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
