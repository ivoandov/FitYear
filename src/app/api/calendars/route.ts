// Alias of /api/calendar/list — legacy clients hit /api/calendars.
import { isCalendarConnected, listUserCalendars } from "@/lib/calendar";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  if (!(await isCalendarConnected(user.id))) return [];
  return await listUserCalendars(user.id);
});
