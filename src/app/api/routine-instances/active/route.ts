import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { routineInstances } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(routineInstances)
    .where(
      and(
        eq(routineInstances.userId, user.id),
        eq(routineInstances.status, "active"),
      ),
    );
  return rows;
});
