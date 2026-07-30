import { sql, type SQL } from "drizzle-orm";

/**
 * Week bucketing that honours the user's "week starts on" setting.
 *
 * Postgres `date_trunc('week', ...)` is always ISO (Monday). The app's setting
 * defaults to SUNDAY, so for the default user a Sunday session counted in the
 * History "This week" tile and GoalsStrip (computed client-side with the
 * setting) but landed in the PREVIOUS week's bar of the chart right beside it.
 *
 * Shifting the timestamp forward a day before truncating, then back after,
 * moves the boundary to Sunday without touching any other arithmetic.
 */
export type WeekStart = "sunday" | "monday";

export function parseWeekStart(raw: string | null | undefined): WeekStart {
  return raw === "monday" ? "monday" : "sunday";
}

/** `date_trunc('week', ...)` for the given week start, over a local-time expr. */
export function weekBucket(localExpr: SQL, weekStart: WeekStart): SQL {
  return weekStart === "monday"
    ? sql`date_trunc('week', ${localExpr})`
    : sql`(date_trunc('week', (${localExpr}) + interval '1 day') - interval '1 day')`;
}
