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
/** Last zone we persisted, so travel writes once instead of every mount. */
const PERSISTED_TZ_KEY = "fy_tz_persisted";

export function TimeZoneCookie() {
  useEffect(() => {
    const tz = clientTimeZone();
    // Re-stamped on every mount so travel or a DST-driven zone change is picked
    // up on the next navigation.
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;

    // Also PERSIST it. The cookie only helps code that has this request; a cron
    // or the read-only integration endpoint another service polls has no
    // request from this device and would otherwise have to assume a zone. Ivo
    // travels, so assuming meant "today" could be a day off.
    //
    // Written only when it CHANGES, tracked in localStorage, so this is one
    // request on first load and one when he lands somewhere new - not a PATCH
    // on every mount.
    try {
      if (window.localStorage.getItem(PERSISTED_TZ_KEY) === tz) return;
      void fetch("/api/user-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZone: tz }),
      })
        .then((res) => {
          // Only remember it as persisted if the server actually accepted it,
          // otherwise a rejected zone would never be retried.
          if (res.ok) window.localStorage.setItem(PERSISTED_TZ_KEY, tz);
        })
        // Signed-out or offline is not worth surfacing; the cookie still works
        // and the next mount retries.
        .catch(() => {});
    } catch {
      // Private mode / storage disabled: skip persistence, keep the cookie.
    }
  }, []);

  return null;
}
