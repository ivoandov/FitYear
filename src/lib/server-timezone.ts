import { cookies } from "next/headers";
import { parseTimeZone } from "@/lib/api/timezone";
import { TZ_COOKIE } from "@/lib/tz-cookie";

export { TZ_COOKIE } from "@/lib/tz-cookie";

/**
 * The VIEWER's IANA timezone for server components.
 *
 * Server components have no access to the browser clock, and on Vercel the
 * server runs in UTC, so day bucketing done with local Date getters put
 * evening workouts on the following day - the server-rendered streak and
 * progress chart then disagreed with the client-rendered heatmap and History.
 * API routes solve this with a `?tz=` query param; pages read this cookie.
 *
 * Falls back to UTC (previous behaviour) when the cookie is absent or invalid,
 * so a first render before the cookie is stamped is never worse than before.
 */
export async function viewerTimeZone(): Promise<string> {
  const jar = await cookies();
  return parseTimeZone(jar.get(TZ_COOKIE)?.value);
}
