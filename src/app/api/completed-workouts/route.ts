import { NextRequest } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { writeNormalizedWorkout, assembleNormalizedExercises } from "@/lib/db/normalized-workout";
import {
  completedWorkouts,
  scheduledWorkouts,
  routineInstances,
  userSettings,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  isCalendarConnected,
} from "@/lib/calendar";

// The stored exercises JSON carries fields the client never reads back from
// here — imageUrl (~38% of the payload), description, instanceId, and default*
// are all re-derived from /api/exercises via enrichExercise (or only matter
// during live tracking). Stripping them shrinks this global, every-page query
// by ~57% (e.g. 375KB -> ~160KB) with no behavior change. Keep only what the
// client actually uses: id (enrich key), name/muscleGroups/exerciseType/
// isAssisted (fallback + stats + PR detection), and setsData (the real data).
function slimExercises(exercises: unknown): unknown {
  if (!Array.isArray(exercises)) return exercises;
  return exercises.map((ex) => {
    const e = ex as Record<string, unknown>;
    return {
      id: e.id,
      name: e.name,
      muscleGroups: e.muscleGroups,
      exerciseType: e.exerciseType,
      isAssisted: e.isAssisted,
      completedSets: e.completedSets,
      setsData: e.setsData,
    };
  });
}

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, user.id))
    .orderBy(desc(completedWorkouts.completedAt));

  // Phase 4c: assemble `exercises[]` from the normalized tables (byte-identical
  // slim shape), falling back to the stored jsonb for any workout that somehow
  // has no normalized rows (shouldn't happen post-backfill; warn if it does and
  // the jsonb actually had exercises).
  const normalized = await assembleNormalizedExercises(rows.map((r) => r.id));
  return rows.map((r) => {
    const norm = normalized.get(r.id);
    if (norm && norm.length > 0) return { ...r, exercises: norm };
    const jsonbExs = Array.isArray(r.exercises) ? r.exercises : [];
    if (jsonbExs.length > 0) {
      console.warn("[4c] no normalized rows for completed workout", r.id);
      Sentry.captureMessage(
        `completed-workout ${r.id} served from jsonb (no normalized rows)`,
        "warning",
      );
    }
    return { ...r, exercises: slimExercises(r.exercises) };
  });
});

const PostSchema = z.object({
  displayId: z.string().min(1),
  name: z.string().min(1),
  exercises: z.unknown(),
  completedAt: z.string().optional(),
  startedAt: z.string().optional(),
  durationSeconds: z.number().int().optional(),
  scheduledWorkoutId: z.string().optional(),
  templateId: z.string().nullable().optional(),
  localDate: z.string().optional(), // accepted but unused server-side; calendar sync deferred to Phase 5b
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  // Stage 1: parallel reads — scheduled workout (for templateId/routineInstance/
  // stale calendar event), calendar-connected check, and selected calendar id.
  const [scheduledWorkoutRow, calendarConnected, settings] = await Promise.all([
    body.scheduledWorkoutId
      ? db
          .select()
          .from(scheduledWorkouts)
          // Scope to the caller: without the userId filter, user A could pass
          // user B's scheduledWorkoutId and bump B's routine progress + pull
          // B's templateId into A's record (IDOR). Not owned by caller -> treated
          // as absent (no templateId / routineInstance linkage below).
          .where(
            and(
              eq(scheduledWorkouts.id, body.scheduledWorkoutId),
              eq(scheduledWorkouts.userId, user.id),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    isCalendarConnected(user.id),
    db
      .select({ calendarId: userSettings.selectedCalendarId })
      .from(userSettings)
      .where(eq(userSettings.userId, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const templateId = body.templateId ?? scheduledWorkoutRow?.templateId ?? null;
  const scheduledRoutineInstanceId =
    scheduledWorkoutRow?.routineInstanceId ?? null;

  const [created] = await db
    .insert(completedWorkouts)
    .values({
      userId: user.id,
      templateId,
      displayId: body.displayId,
      name: body.name,
      exercises: body.exercises,
      completedAt: body.completedAt ? new Date(body.completedAt) : new Date(),
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      durationSeconds: body.durationSeconds ?? null,
      routineInstanceId: scheduledRoutineInstanceId,
    })
    .returning();

  // Phase 4 dual-write (best-effort): mirror into the normalized tables. Never
  // fails the request — the jsonb above stays the source of truth until reads
  // are switched over. A failure is reported to Sentry and reconciled by the
  // backfill script.
  try {
    await writeNormalizedWorkout(created.id, body.exercises);
  } catch (e) {
    console.error("[dual-write] normalized insert failed", e);
    Sentry.captureException(e);
  }

  // Stage 2: parallel side effects after the insert succeeds.
  //   - Routine progress increment
  //   - Stale "(Scheduled)" event deletion
  //   - New completed event creation (then a tiny update with the event id)
  const sideEffects: Promise<unknown>[] = [];

  if (scheduledRoutineInstanceId) {
    sideEffects.push(
      db
        .update(routineInstances)
        .set({
          completedWorkouts: sql`${routineInstances.completedWorkouts} + 1`,
        })
        .where(eq(routineInstances.id, scheduledRoutineInstanceId)),
    );
  }

  if (calendarConnected) {
    if (scheduledWorkoutRow?.calendarEventId) {
      sideEffects.push(
        deleteCalendarEvent(
          user.id,
          scheduledWorkoutRow.calendarEventId,
          settings?.calendarId ?? undefined,
        ),
      );
    }

    sideEffects.push(
      (async () => {
        const eventId = await createCalendarEvent(
          user.id,
          body.name,
          created.completedAt,
          settings?.calendarId ?? undefined,
          body.localDate,
        );
        if (eventId) {
          await db
            .update(completedWorkouts)
            .set({ calendarEventId: eventId })
            .where(eq(completedWorkouts.id, created.id));
          created.calendarEventId = eventId;
        }
      })(),
    );
  }

  await Promise.all(sideEffects);

  return new Response(JSON.stringify(created), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
});
