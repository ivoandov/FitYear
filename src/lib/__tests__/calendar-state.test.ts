import { describe, it, expect, beforeAll } from "vitest";
import { signCalendarState, verifyCalendarState } from "@/lib/calendar-state";

beforeAll(() => {
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = "test-key-for-calendar-state-signing";
});

const USER = "6f1c2a44-0000-4000-8000-000000000001";

describe("signCalendarState / verifyCalendarState", () => {
  it("round-trips the user id without needing a session", () => {
    // The whole point: the callback can identify the user from the state alone,
    // because from the system browser it has no cookie to read.
    const state = signCalendarState(USER);
    expect(verifyCalendarState(state)).toEqual({ ok: true, userId: USER });
  });

  it("REJECTS a state whose user id was edited", () => {
    // This is the CSRF guarantee. Swapping in a victim's id must not let an
    // attacker attach their own Google tokens to that account.
    const state = signCalendarState(USER);
    const tampered = state.replace(USER, "6f1c2a44-0000-4000-8000-000000000002");
    expect(verifyCalendarState(tampered)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a state signed with a different key", () => {
    const state = signCalendarState(USER);
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = "a-completely-different-key";
    expect(verifyCalendarState(state).ok).toBe(false);
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = "test-key-for-calendar-state-signing";
  });

  it("expires", () => {
    const now = Date.now();
    const state = signCalendarState(USER, now);
    // Just inside the window, then well past it.
    expect(verifyCalendarState(state, now + 9 * 60 * 1000).ok).toBe(true);
    expect(verifyCalendarState(state, now + 11 * 60 * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects malformed input instead of throwing", () => {
    // A tampered state must be a REJECTION, not an exception: timingSafeEqual
    // throws on a length mismatch, which would surface as a 500 rather than a
    // clean "state_mismatch" for anyone editing the URL.
    for (const bad of [null, "", "nonsense", "v1.only.three.parts", "v2.a.b.c.d"]) {
      const r = verifyCalendarState(bad);
      expect(r.ok, `${JSON.stringify(bad)} must be rejected`).toBe(false);
    }
  });

  it("mints a DIFFERENT state each time for the same user", () => {
    // The nonce makes two connect attempts distinguishable and stops a state
    // being replayed from a log after it was used.
    expect(signCalendarState(USER)).not.toBe(signCalendarState(USER));
  });
});
