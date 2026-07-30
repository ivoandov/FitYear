import { NextRequest } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { workoutTemplates, scheduledWorkouts } from "@/lib/db/schema";
import { ApiError, requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Push an edited template's exercises onto its FUTURE scheduled workouts.
 *
 * The Home page has always offered this ("You have future scheduled workouts
 * based on this workout. Would you like to update them with the new
 * exercises?"), but the route was never ported from the Replit app, so every
 * confirm 404'd into the failure toast and the scheduled rows silently kept
 * their pre-edit exercises.
 *
 * Deliberately future-only: a scheduled workout in the past is a record of what
 * was planned then, and one already completed has its own normalized rows.
 */
export const POST = handle(async (_request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;

  const [template] = await db
    .select()
    .from(workoutTemplates)
    .where(
      and(eq(workoutTemplates.id, id), eq(workoutTemplates.userId, user.id)),
    )
    .limit(1);
  if (!template) throw new ApiError(404, "Workout not found");

  // Start of today, so a workout scheduled for later today still updates.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const updated = await db
    .update(scheduledWorkouts)
    .set({
      exercises: template.exercises,
      name: template.name,
    })
    .where(
      and(
        // userId-scoped: templateId is a plain varchar with no FK, so an
        // unscoped update could reach another user's rows.
        eq(scheduledWorkouts.userId, user.id),
        eq(scheduledWorkouts.templateId, id),
        gte(scheduledWorkouts.date, todayStart),
      ),
    )
    .returning({ id: scheduledWorkouts.id });

  return { ok: true, updatedCount: updated.length };
});
