/**
 * `completed_workouts.completed_at` is a tz-naive timestamp holding UTC wall
 * clock, but every client-side date calculation (localDateKey, streaks, the
 * heatmap) uses the user's LOCAL day. Bucketing in SQL without converting put
 * roughly half of an evening-training user's sessions on the wrong day, and
 * leaked Sunday-night workouts into the next week.
 *
 * Routes take an IANA zone from the client and pass it through `parseTimeZone`
 * before interpolating it into a `AT TIME ZONE` expression.
 */

// Deliberately strict: the value is interpolated into SQL, and anything that
// isn't a plausible IANA name falls back to UTC (the previous behaviour) rather
// than erroring the whole endpoint.
const IANA = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

export function parseTimeZone(raw: string | null | undefined): string {
  if (!raw || raw.length > 64 || !IANA.test(raw)) return "UTC";
  try {
    // Cheapest real validation available server-side: constructing a formatter
    // throws RangeError on an unknown zone.
    new Intl.DateTimeFormat("en-US", { timeZone: raw });
    return raw;
  } catch {
    return "UTC";
  }
}
