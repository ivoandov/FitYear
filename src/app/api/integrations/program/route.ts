import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  exercises,
  routines,
  routineEntries,
  routineInstances,
  userSettings,
} from "@/lib/db/schema";
import { handle } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { requireIntegrationWriter } from "@/lib/api/integration-auth";
import { cycleLengthFor, entriesFor, parseProgramRequest } from "@/lib/integration-program";
import { makeNameReconciler } from "@/lib/api/reconcile-names";
import { startRoutine } from "@/lib/api/start-routine";
import { endProgram } from "@/lib/api/end-program";
import { replaceCoachDocumentByTitle } from "@/lib/api/coach-documents";
import { createCoachNote } from "@/lib/api/coach-notes";
import { normalizeRule } from "@/lib/progression";
import { localDateKeyInZone } from "@/lib/date";

/**
 * POST /api/integrations/program
 *
 * The one door through which another system puts a program into FitYear. Built
 * 2026-09-23 for Liv, Ivo's assistant, after: "things are fragmented across
 * apps/agents... I want you to build the ability for it to happen seamlessly."
 * Liv reads his whole health record and what he has actually trained; this is
 * how what she designs lands here as the running program, in one call.
 *
 * ## What one call does, in order, and why the order
 *
 *   1. Validates the body (`lib/integration-program`, pure, tested) and
 *      reconciles every exercise name against the catalog through the SAME
 *      reconciler FitBot's program builder uses, so the program reuses catalog
 *      identity rather than fragmenting it.
 *   2. With `dryRun`, stops here and returns the plan: what would be renamed,
 *      what would be created, what would be ended. Nothing is written.
 *   3. Saves the routine, REPLACING one of the same name if it exists, so a
 *      retried call cannot leave two routines behind.
 *   4. Ends the running program if `endActive` says so, through the button's own
 *      soft cancel, and REFUSES with 409 if one is running and the caller did not
 *      say so. Another system must never quietly end somebody's block.
 *   5. Starts the routine through the Start button's own code (`startRoutine`),
 *      which inherits the repeat, the progression and the date-conflict check.
 *   6. Files the document and the coach note, if sent, and reports their
 *      outcome WITHOUT failing the call: the program is the act, and a document
 *      that would not save is a fact to report beside a program that did start.
 *
 * Already running this same routine: answers 200 with the existing instance and
 * writes nothing, so a retry gets the same answer as the first attempt.
 *
 * ## Auth, and why it is a second secret
 *
 * `/api/integrations/schedule` established the read door: a shared secret bound
 * server-side to ONE user id, read-only by rule, because a secret in another
 * service's env is weaker than a session. That rule stands for the READ key.
 * This route takes a DIFFERENT secret (`INTEGRATION_WRITE_KEY`), held only by
 * the one consumer that writes, so the read key leaking still cannot mutate,
 * and the blast radius of the write key is this route: it creates a routine,
 * ends and starts a program, and files a document or a note for that one user.
 * It cannot touch completed history, settings, exercises or anyone else.
 *
 * Listed under the `/api/integrations` prefix that `proxy.ts` exempts from the
 * cookie gate; the route authenticates itself.
 */
export const maxDuration = 60;

const DEFAULT_TZ = "America/Los_Angeles";

function safeZone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

const NO_STORE = { "cache-control": "no-store, private" };

export const POST = handle(async (request: NextRequest) => {
  const { userId } = requireIntegrationWriter(request);

  // The zone the DEVICE last reported, so "today" and the start date are his
  // days rather than the server's. Same precedence the schedule read uses.
  const [settings] = await db
    .select({ timeZone: userSettings.timeZone })
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  const timeZone = safeZone(settings?.timeZone ?? null);
  const today = localDateKeyInZone(new Date(), timeZone);

  const raw = await request.json().catch(() => null);
  const parsed = parseProgramRequest(raw, today);
  if (!parsed.ok) throw new ApiError(400, parsed.why);
  const req = parsed.request;

  const catalog = await db.select({ id: exercises.id, name: exercises.name }).from(exercises);
  const reconciler = makeNameReconciler(catalog);
  const entries = entriesFor(req.routine.days, reconciler.reconcile);
  const cycleLength = cycleLengthFor(req.routine.days);

  const [active] = await db
    .select()
    .from(routineInstances)
    .where(and(eq(routineInstances.userId, userId), eq(routineInstances.status, "active")))
    .orderBy(desc(routineInstances.createdAt))
    .limit(1);

  const [existingRoutine] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.userId, userId), eq(routines.name, req.routine.name)))
    .limit(1);

  const sameRoutineRunning =
    active != null && existingRoutine != null && active.routineId === existingRoutine.id;

  const plan = {
    routineName: req.routine.name,
    cycleLength,
    days: entries.map((e) => ({
      dayIndex: e.dayIndex,
      workoutName: e.workoutName,
      exerciseCount: e.exercises.length,
    })),
    renamed: reconciler.renamed,
    created: reconciler.created,
    start: req.start,
    reusesRoutineId: existingRoutine?.id ?? null,
    wouldEnd:
      active != null && !sameRoutineRunning
        ? { id: active.id, routineName: active.routineName }
        : null,
  };

  if (req.dryRun === true) {
    return Response.json({ ok: true, dryRun: true, plan }, { status: 200, headers: NO_STORE });
  }

  if (sameRoutineRunning && active) {
    return Response.json(
      {
        ok: true,
        alreadyRunning: true,
        routineId: existingRoutine!.id,
        routineName: req.routine.name,
        routineInstanceId: active.id,
        startDate: active.startDate,
        endDate: active.endDate,
        plan,
      },
      { status: 200, headers: NO_STORE },
    );
  }

  if (active && req.endActive !== true) {
    throw new ApiError(409, "A program is already running", {
      activeProgramId: active.id,
      routineName: active.routineName,
    });
  }

  // 3. The routine, replaced in place by name so a retry cannot leave two.
  const progression =
    req.routine.progression === undefined
      ? undefined
      : req.routine.progression === null
        ? null
        : normalizeRule(req.routine.progression);

  const routineId = await db.transaction(async (tx) => {
    let id: string;
    if (existingRoutine) {
      id = existingRoutine.id;
      await tx
        .update(routines)
        .set({
          description: req.routine.description ?? existingRoutine.description,
          defaultDurationDays: req.start.durationDays,
          cycleLength,
          ...(progression !== undefined ? { progression } : {}),
        })
        .where(eq(routines.id, id));
      await tx.delete(routineEntries).where(eq(routineEntries.routineId, id));
    } else {
      const [row] = await tx
        .insert(routines)
        .values({
          userId,
          name: req.routine.name,
          description: req.routine.description ?? null,
          defaultDurationDays: req.start.durationDays,
          isPublic: false,
          cycleLength,
          ...(progression !== undefined ? { progression } : {}),
        })
        .returning();
      id = row.id;
    }
    await tx.insert(routineEntries).values(
      entries.map((e) => ({
        routineId: id,
        dayIndex: e.dayIndex,
        workoutTemplateId: null,
        workoutName: e.workoutName,
        exercises: e.exercises,
      })),
    );
    return id;
  });

  // 4. End the running program AFTER the routine is saved and BEFORE the start,
  // because the start refuses date conflicts with sessions the old one holds.
  let endedProgramId: string | null = null;
  if (active && req.endActive === true) {
    await endProgram({ userId, instanceId: active.id });
    endedProgramId = active.id;
  }

  // 5. Start it, through the Start button's own code.
  let started: Awaited<ReturnType<typeof startRoutine>>;
  try {
    started = await startRoutine({
      userId,
      routineId,
      startDate: req.start.startDate,
      durationDays: req.start.durationDays,
      timeZone,
    });
  } catch (e) {
    // The routine is saved and the old program may be ended. Say so, so the
    // caller can tell the person the truth rather than "it failed".
    if (e instanceof ApiError) {
      throw new ApiError(e.status, e.message, {
        ...(typeof e.details === "object" && e.details ? e.details : {}),
        routineId,
        endedProgramId,
        savedRoutine: true,
      });
    }
    throw e;
  }

  // 6. The document and the note. Reported, never fatal.
  let document: { ok: boolean; id?: string; why?: string } | null = null;
  if (req.document) {
    try {
      const r = await replaceCoachDocumentByTitle(userId, {
        title: req.document.title,
        content: req.document.content,
        source: "user",
        today,
      });
      document = r.ok ? { ok: true, id: r.document.id } : { ok: false, why: r.reason };
    } catch {
      document = { ok: false, why: "failed" };
    }
  }
  let note: { ok: boolean; id?: string; why?: string } | null = null;
  if (req.note) {
    try {
      const r = await createCoachNote(
        userId,
        { kind: "context", content: req.note, source: "user" },
        today,
      );
      note = r.ok
        ? { ok: true, id: r.note.id }
        : { ok: r.reason === "duplicate", why: r.reason };
    } catch {
      note = { ok: false, why: "failed" };
    }
  }

  console.info(
    "[integrations/program]",
    JSON.stringify({
      routineId,
      routineInstanceId: started.instance.id,
      created: started.createdWorkouts.length,
      endedProgramId,
      renamed: reconciler.renamed.length,
      newExercises: reconciler.created.length,
    }),
  );

  return Response.json(
    {
      ok: true,
      routineId,
      routineName: req.routine.name,
      routineInstanceId: started.instance.id,
      startDate: started.instance.startDate,
      endDate: started.instance.endDate,
      createdCount: started.createdWorkouts.length,
      endedProgramId,
      plan,
      document,
      note,
    },
    { status: 201, headers: NO_STORE },
  );
});
