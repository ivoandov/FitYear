import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  completedWorkouts,
  scheduledWorkouts,
  workoutTemplates,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Backfills templateId on existing scheduled & completed workouts by matching
// on (lowercased, trimmed) name to the user's templates. Mirrors the Replit
// "Sync Template History" action used for legacy users whose workouts were
// created before the templateId link existed.
export const POST = handle(async () => {
  const { user } = await requireUser();

  const templates = await db
    .select({ id: workoutTemplates.id, name: workoutTemplates.name })
    .from(workoutTemplates)
    .where(eq(workoutTemplates.userId, user.id));

  const byName = new Map<string, string>();
  for (const t of templates) {
    if (t.name) byName.set(t.name.toLowerCase().trim(), t.id);
  }

  let scheduledUpdated = 0;
  const sched = await db
    .select({ id: scheduledWorkouts.id, name: scheduledWorkouts.name })
    .from(scheduledWorkouts)
    .where(
      and(
        eq(scheduledWorkouts.userId, user.id),
        isNull(scheduledWorkouts.templateId),
      ),
    );
  for (const w of sched) {
    const matched = byName.get(w.name.toLowerCase().trim());
    if (matched) {
      await db
        .update(scheduledWorkouts)
        .set({ templateId: matched })
        .where(eq(scheduledWorkouts.id, w.id));
      scheduledUpdated++;
    }
  }

  let completedUpdated = 0;
  const comp = await db
    .select({ id: completedWorkouts.id, name: completedWorkouts.name })
    .from(completedWorkouts)
    .where(
      and(
        eq(completedWorkouts.userId, user.id),
        isNull(completedWorkouts.templateId),
      ),
    );
  for (const w of comp) {
    const matched = byName.get(w.name.toLowerCase().trim());
    if (matched) {
      await db
        .update(completedWorkouts)
        .set({ templateId: matched })
        .where(eq(completedWorkouts.id, w.id));
      completedUpdated++;
    }
  }

  return {
    success: true,
    scheduledUpdated,
    completedUpdated,
    message: `Updated ${scheduledUpdated} scheduled workouts and ${completedUpdated} completed workouts`,
  };
});
