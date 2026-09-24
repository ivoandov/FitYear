import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { startRoutine } from "@/lib/api/start-routine";
import { viewerTimeZone } from "@/lib/server-timezone";

type Ctx = { params: Promise<{ id: string }> };

const Schema = z.object({
  // Must be a real date: an unparseable string became `Invalid Date`, and the
  // conflict loop's `d.toISOString()` then threw a RangeError as a generic 500.
  startDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "startDate must be a valid date"),
  durationDays: z.number().int().positive().max(366).optional(),
});

/**
 * The body of this route lives in `lib/api/start-routine.ts` since 2026-09-23,
 * so the integration door starts a program through exactly this code. Nothing
 * about what it refuses or writes moved with it.
 */
export const POST = handle(async (request: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const body = Schema.parse(await request.json());

  const { instance, createdWorkouts } = await startRoutine({
    userId: user.id,
    routineId: id,
    startDate: body.startDate,
    durationDays: body.durationDays,
    timeZone: await viewerTimeZone(),
  });

  // NOTE: Google Calendar event creation deferred to Phase 5b
  return new Response(
    JSON.stringify({
      success: true,
      routineInstance: instance,
      createdCount: createdWorkouts.length,
      workouts: createdWorkouts,
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
});
