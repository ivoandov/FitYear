/**
 * Name of the cookie the client stamps with its IANA timezone.
 *
 * Lives in its own module with NO imports: it is shared by a client component
 * (components/TimeZoneCookie) and a server-only one (lib/server-timezone, which
 * imports next/headers). Putting it in the server module pulled next/headers
 * into the client bundle and failed the build.
 */
export const TZ_COOKIE = "fy_tz";
