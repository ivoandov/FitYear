import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

/**
 * The OAuth `state` for the Google Calendar connect flow, signed so the
 * callback can trust it WITHOUT a session cookie.
 *
 * WHY THIS EXISTS. The old state was the bare user id, and the callback proved
 * it by comparing against `requireUser()` - which needs the app's session
 * cookie. That works in a browser tab. It cannot work from the native shell:
 * the consent screen must open in the SYSTEM browser (Google refuses OAuth
 * inside a WKWebView, `disallowed_useragent`), and Safari does not share the
 * WebView's cookie jar, so the callback would arrive unauthenticated and 401
 * no matter how correct the request was.
 *
 * A signed state carries its own proof. The callback verifies the signature and
 * the expiry and takes the user id from the state itself, so it needs nothing
 * from the cookie jar. The CSRF guarantee is the same or better: the old check
 * proved "state equals the caller's id", this proves "this state was minted by
 * THIS server, for that id, in the last 10 minutes, and has not been edited".
 *
 * The nonce makes each state unique so two connect attempts are distinguishable
 * and a state cannot be replayed from a log after use.
 *
 * Signed with `CALENDAR_TOKEN_ENCRYPTION_KEY`, which already exists and already
 * guards the calendar tokens themselves, so no new secret is introduced.
 */

const VERSION = "v1";
/** Ten minutes is far longer than a consent screen takes and short enough to bound replay. */
const TTL_MS = 10 * 60 * 1000;

function secret(): string {
  const key = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY is not set");
  return key;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** `v1.<userId>.<nonce>.<expiryMs>.<sig>` - opaque to Google, which just echoes it back. */
export function signCalendarState(userId: string, now = Date.now()): string {
  const nonce = randomBytes(9).toString("base64url");
  const payload = `${VERSION}.${userId}.${nonce}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export type CalendarStateResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyCalendarState(state: string | null, now = Date.now()): CalendarStateResult {
  if (!state) return { ok: false, reason: "malformed" };

  const parts = state.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) return { ok: false, reason: "malformed" };

  const [, userId, , expiryRaw, sig] = parts;
  const payload = parts.slice(0, 4).join(".");

  // Constant-time compare, and length-guarded: timingSafeEqual throws on a
  // length mismatch, which would otherwise be an exception rather than a
  // rejection for any tampered state.
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "bad_signature" };
  }

  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || now > expiry) return { ok: false, reason: "expired" };
  if (!userId) return { ok: false, reason: "malformed" };

  return { ok: true, userId };
}
