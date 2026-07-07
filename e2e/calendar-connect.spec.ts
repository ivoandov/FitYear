import { test, expect } from "./fixtures";

// Regression: /api/calendar/connect must NOT return a server redirect. The
// settings page fetches this endpoint (expecting JSON { authUrl }) then does a
// top-level navigation to Google. A redirect here gets FOLLOWED by the client's
// fetch into accounts.google.com, which the CSP connect-src blocks -> surfaces
// as a bogus "network error" on Connect Calendar.
//
// The env-independent contract is "not a server redirect". When Google OAuth
// creds are configured (prod), it's a 200 JSON { authUrl }; CI has no GOOGLE_*
// creds, so there we only assert it didn't redirect.
const REDIRECT_CODES = [301, 302, 303, 307, 308];

test("calendar connect does not server-redirect", async ({ page, account }) => {
  void account; // the fixture authenticates the browser context
  const res = await page.request.get("/api/calendar/connect", {
    maxRedirects: 0,
  });
  expect(REDIRECT_CODES).not.toContain(res.status());
  if (res.status() === 200) {
    const body = (await res.json()) as { authUrl?: string };
    expect(body.authUrl).toContain("accounts.google.com");
    expect(body.authUrl).toContain("scope=");
  }
});
