import { isCalendarConnected } from "@/lib/calendar";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const connected = await isCalendarConnected(user.id);
  return { connected, userId: user.id };
});
