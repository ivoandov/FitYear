"use client";

import { useEffect } from "react";
import { clientTimeZone } from "@/lib/date";
import { TZ_COOKIE } from "@/lib/tz-cookie";

/**
 * Stamps the viewer's IANA timezone into a cookie so SERVER components can
 * bucket days in the viewer's zone instead of the server's (UTC on Vercel).
 * API routes get the same information from a `?tz=` query param; pages cannot
 * send one, hence the cookie.
 *
 * Renders nothing. Not httpOnly on purpose - it carries no secret and the
 * server treats it as an untrusted hint (validated by `parseTimeZone`, falling
 * back to UTC).
 */
export function TimeZoneCookie() {
  useEffect(() => {
    const tz = clientTimeZone();
    // Re-stamped on every mount so travel or a DST-driven zone change is picked
    // up on the next navigation.
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  return null;
}
