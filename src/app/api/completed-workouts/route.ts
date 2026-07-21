import { NextRequest } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { writeNormalizedRows, assembleNormalizedExercises } from "@/lib/db/normalized-workout";
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

export const GET = handle(async () => {
  const { user } = await requireUser();
  const rows = await db
    .select()
    .from(completedWorkouts)
    .where(eq(completedWorkouts.userId, user.id))
    .orderBy(desc(completedWorkouts.completedAt));

  // Phase 4d: assemble `exercises[]` from the normalized tables (the sole store)
  // in the slim shape clients have always consumed. A workout with no normalized
  // rows is unexpected post-cutover (parity-verified) — return an empty list and
  // flag it to Sentry rather than crashing.
  const normalized = await assembleNormalizedExercises(rows.map((r) => r.id));
  return rows.map((r) => {
    const norm = normalized.get(r.id);
    if (!norm || norm.length === 0) {
      Sentry.captureMessage(
        `completed-workout ${r.id} has no normalized rows`,
        "warning",
      );
    }
    return { ...r, exercises: norm ?? [] };
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

// True when the error (or its cause chain) is a Postgres unique violation.
function isUniqueViolation(e: unknown): boolean {
  let cur = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; cur && i < 4; i++) {
    if (cur.code === "23505") return true;
    cur = cur.cause as { code?: string; cause?: unknown } | undefined;
  }
  return false;
}

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const body = PostSchema.parse(await request.json());

  // Idempotency: the same save retried or double-fired (double-tap, a second
  // tab/device sharing the active workout - the 2026-07-14 duplicate) must not
  // insert twice. displayId is client-unique per workout instance and a DB
  // unique index enforces (user_id, display_id); a repeat save returns the
  // already-saved row (200) and skips every side effect the first save ran.
  const findExisting = () =>
    db
      .select()
      .from(completedWorkouts)
      .where(
        and(
          eq(completedWorkouts.userId, user.id),
          eq(completedWorkouts.displayId, body.displayId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

  const duplicate = await findExisting();
  if (duplicate) {
    return new Response(JSON.stringify(duplicate), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

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

  // Phase 4d: insert the workout and its normalized exercises/sets in ONE
  // transaction — the normalized tables are the sole store, so a failure to
  // write the sets must roll the whole save back (the request then 500s and the
  // client retries) rather than persist a workout with no sets.
  let created;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(completedWorkouts)
        .values({
          userId: user.id,
          templateId,
          displayId: body.displayId,
          name: body.name,
          completedAt: body.completedAt ? new Date(body.completedAt) : new Date(),
          startedAt: body.startedAt ? new Date(body.startedAt) : null,
          durationSeconds: body.durationSeconds ?? null,
          routineInstanceId: scheduledRoutineInstanceId,
        })
        .returning();
      await writeNormalizedRows(tx, row.id, body.exercises);
      return row;
    });
  } catch (e) {
    // Two truly concurrent saves can both pass the pre-check; the unique index
    // rejects the loser, which then returns the winner's row.
    if (isUniqueViolation(e)) {
      const winner = await findExisting();
      if (winner) {
        return new Response(JSON.stringify(winner), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    throw e;
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
