import { getCalendarAuthUrl } from "@/lib/calendar";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Return the Google consent URL as JSON, NOT a server redirect. The client
// (settings page) fetches this and then does a top-level window.location.href
// to Google. A redirect here would be FOLLOWED by the client's fetch into
// accounts.google.com, which the CSP connect-src blocks -> surfaces as a
// spurious "network error" on Connect Calendar. OAuth must be initiated by a
// top-level navigation, which the client does with the returned authUrl.
export const GET = handle(async () => {
  const { user } = await requireUser();
  const authUrl = getCalendarAuthUrl(user.id);
  return { authUrl };
});
