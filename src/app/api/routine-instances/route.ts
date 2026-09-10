import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { loadRoutineInstances } from "@/lib/api/home-payload";

export const GET = handle(async () => {
  const { user } = await requireUser();
  // Shared with the server-rendered Home payload so the two cannot drift.
  return loadRoutineInstances(user.id);
});
