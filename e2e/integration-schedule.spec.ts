/**
 * Durable guard for the machine-to-machine integration endpoint
 * (GET /api/integrations/schedule, built 2026-08-25 for Liv).
 *
 * The auth boundary is the whole point of this spec. This is the ONLY route in
 * FitYear that is not behind a Supabase session, so if its own check ever
 * regresses, one shared secret in another service's env becomes an open read of
 * a user's training data. These tests are deliberately adversarial.
 *
 * Uses page.request (raw HTTP, no session cookie) ON PURPOSE - unlike every
 * other spec, which drives in-browser fetch to carry the cookie. A machine
 * caller has no cookie, and that is exactly the shape under test.
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const KEY = process.env.INTEGRATION_API_KEY ?? "";
const url = `${BASE}/api/integrations/schedule`;

test.describe("integration schedule endpoint", () => {
  test("rejects a request with no Authorization header", async ({ request }) => {
    const res = await request.get(url);
    expect(res.status()).toBe(401);
    // Must NOT be a 307 to /login: the proxy exemption has to hold, or the
    // endpoint is unreachable for a machine caller regardless of its own auth.
    expect(res.status()).not.toBe(307);
  });

  test("rejects a wrong key, a malformed header, and a non-Bearer scheme", async ({ request }) => {
    for (const header of [
      "Bearer totally-wrong-key-that-is-long-enough-to-pass-length",
      "Bearer ",
      "Basic dXNlcjpwYXNz",
      KEY, // raw key with no Bearer prefix
    ]) {
      const res = await request.get(url, { headers: { authorization: header } });
      expect(res.status(), `header: ${header.slice(0, 20)}`).toBe(401);
    }
  });

  test("does not reveal which check failed", async ({ request }) => {
    const res = await request.get(url, { headers: { authorization: "Bearer nope" } });
    const body = await res.text();
    expect(body).not.toMatch(/length|configured|user|env|INTEGRATION/i);
  });

  test("is READ-ONLY: every mutating verb is refused", async ({ request }) => {
    const headers = { authorization: `Bearer ${KEY}` };
    for (const call of [
      request.post(url, { headers, data: {} }),
      request.put(url, { headers, data: {} }),
      request.patch(url, { headers, data: {} }),
      request.delete(url, { headers }),
    ]) {
      const res = await call;
      // 405 from Next's route handler (only GET is exported).
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(res.status()).not.toBe(200);
    }
  });

  test("returns a shaped payload for a valid key, leaking nothing", async ({ request }) => {
    test.skip(!KEY, "INTEGRATION_API_KEY not set in this environment");
    const res = await request.get(url, { headers: { authorization: `Bearer ${KEY}` } });
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");

    const body = await res.json();
    expect(body).toHaveProperty("as_of");
    expect(body).toHaveProperty("timezone");
    // `active` must be PRESENT and explicitly null when nothing is running -
    // the consumer distinguishes "could not read" from "nothing scheduled",
    // and an absent key would collapse those.
    expect(Object.keys(body)).toContain("active");
    expect(Array.isArray(body.upcoming)).toBe(true);
    expect(Array.isArray(body.recent)).toBe(true);
    // Counts only by default; no exercise objects unless detail is requested.
    for (const u of body.upcoming) {
      expect(u).toHaveProperty("exercise_count");
      expect(u).not.toHaveProperty("exercises");
      expect(u.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const json = JSON.stringify(body);
    // No email, no credential-shaped field, and crucially no signed GCS URL
    // from the legacy exercise blobs.
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/X-Goog-Signature|storage\.googleapis\.com/);
    expect(json).not.toMatch(/refresh_token|service_role|supabase/i);
  });

  test("the days window and timezone are clamped/validated, not trusted", async ({ request }) => {
    test.skip(!KEY, "INTEGRATION_API_KEY not set in this environment");
    for (const q of ["days=99999", "days=-5", "days=abc", "days=0", "tz=Not/AZone", "tz="]) {
      const res = await request.get(`${url}?${q}`, {
        headers: { "x-fityear-key": KEY },
      });
      expect(res.status(), q).toBe(200);
      const body = await res.json();
      // An unusable zone falls back rather than throwing or echoing junk.
      expect(typeof body.timezone).toBe("string");
      expect(body.timezone.length).toBeGreaterThan(0);
    }
  });

  test("accepts the x-fityear-key header as well as Bearer", async ({ request }) => {
    test.skip(!KEY, "INTEGRATION_API_KEY not set in this environment");
    const a = await request.get(url, { headers: { "x-fityear-key": KEY } });
    const b = await request.get(url, { headers: { authorization: `Bearer ${KEY}` } });
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
  });

  test("detail=full opts into exercise objects, still without image URLs", async ({ request }) => {
    test.skip(!KEY, "INTEGRATION_API_KEY not set in this environment");
    const res = await request.get(`${url}?detail=full`, { headers: { "x-fityear-key": KEY } });
    expect(res.status()).toBe(200);
    const json = JSON.stringify(await res.json());
    expect(json).not.toMatch(/X-Goog-Signature|storage\.googleapis\.com/);
  });
});
