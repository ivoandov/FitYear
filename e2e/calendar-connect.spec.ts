import { test, expect } from "./fixtures";

// Regression: /api/calendar/connect must return the Google consent URL as JSON
// ({ authUrl }), so the client can do a top-level navigation to it. It must NOT
// return a server redirect — the client fetches this endpoint, and a redirect
// would be followed into accounts.google.com, which the CSP connect-src blocks,
// surfacing as a bogus "network error" on Connect Calendar.
test("calendar connect returns a Google auth URL as JSON, not a redirect", async ({
  page,
}) => {
  const res = await page.request.get("/api/calendar/connect", {
    maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { authUrl?: string };
  expect(body.authUrl).toContain("accounts.google.com");
  expect(body.authUrl).toContain("scope=");
});
