import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { routines, routineEntries } from "@/lib/db/schema";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { parseTimeZone } from "@/lib/api/timezone";
import { exerciseCatalogPromptBlock } from "@/lib/api/exercise-catalog-prompt";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import { loadTrainingHistory, trainingHistoryPromptBlock } from "@/lib/api/training-history";
import { EditedRoutineSchema } from "@/lib/routine-edit-schema";

/**
 * Change an existing routine by describing the change.
 *
 * The gap this closes, in Ivo's words: "take my current routine, adjust it to 4
 * days a week instead of 5, figure out what muscle groups I am low on in volume
 * and add accessory exercises on days where they are fitting with some of my
 * most used exercises for that muscle group."
 *
 * Every AI route before this one took a description and returned a plan from a
 * blank page. None could read what the user had trained, and none could touch a
 * routine that already existed - so FitBot could write you a program and then
 * had no idea whether you did any of it. This one is handed both the routine
 * and the training history, which is what makes it a coach rather than a
 * generator.
 *
 * PREVIEW ONLY. Nothing is persisted here; the client shows the diff and the
 * user saves. An AI route that silently rewrote a live routine - and with it
 * every scheduled workout hanging off it - would be a bad way to find out the
 * model misread you.
 */
export const maxDuration = 60;

/** One edit is one metered call, the same unit a refine costs. */
const EDIT_ROUTINE_DAILY_LIMIT = 30;

const InputSchema = z.object({
  routineId: z.string().min(1),
  instruction: z.string().trim().min(1).max(1000),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new ApiError(502, "Fit Bot didn't return an update. Please try again.");
  }
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new ApiError(502, "Fit Bot returned an invalid update. Please try again.");
  }
}

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  await enforceDailyQuota(user.id, "edit-routine", EDIT_ROUTINE_DAILY_LIMIT);
  const input = InputSchema.parse(await request.json());
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }

  // Scoped to the caller. routine_entries.routine_id is a plain varchar with no
  // foreign key, so ownership is checked on the ROUTINE and the entries are
  // read through it rather than trusted from the request.
  const [routine] = await db
    .select()
    .from(routines)
    .where(and(eq(routines.id, input.routineId), eq(routines.userId, user.id)))
    .limit(1);
  if (!routine) throw new ApiError(404, "Routine not found");

  const entries = await db
    .select()
    .from(routineEntries)
    .where(eq(routineEntries.routineId, routine.id))
    .orderBy(asc(routineEntries.dayIndex));
  if (!entries.length) throw new ApiError(400, "That routine has no days to edit.");

  const [history, catalogBlock] = await Promise.all([
    loadTrainingHistory(user.id, tz),
    exerciseCatalogPromptBlock(),
  ]);
  const historyBlock = trainingHistoryPromptBlock(history);

  const current = {
    name: routine.name,
    cycleLength: routine.cycleLength ?? null,
    durationDays: routine.defaultDurationDays ?? null,
    days: entries.map((e) => ({
      dayIndex: e.dayIndex,
      workoutName: e.workoutName ?? `Day ${e.dayIndex}`,
      exercises: e.exercises ?? [],
    })),
  };

  const prompt = `You are an expert strength coach editing a training routine you built for this user.

THEIR CURRENT ROUTINE (JSON):
${JSON.stringify(current)}

WHAT THEY ASKED FOR:
"${input.instruction}"
${historyBlock}
${catalogBlock}

RULES.
- Apply what they asked and nothing else. Days and exercises they did not ask about keep their name, order, sets, reps and rest exactly.
- dayIndex is a position in the ROTATION, starting at 1. Rest days are simply absent from the list - do not emit an entry for one. If they ask for fewer training days per week, remove or merge days and RENUMBER the remaining ones so they stay consecutive from 1, then set cycleLength to the rotation period (7 for a weekly cycle).
- Reps are free text and stay free text: "6-8", "AMRAP", "30s" are all valid. Never convert a range into a single number.
- targetLoadLbs is a deterministic per-week target the app computes for anchor lifts. Carry it through unchanged on any exercise that already had one, and do NOT invent one for an exercise that did not.
- When adding work for an under-trained muscle group, prefer exercises from THEIR MOST-USED list for that group. Reach outside it only when nothing there fits the day.
- Respect any injury or constraint they mention and swap out anything that would aggravate it.

Return ONLY valid JSON, no preamble and no markdown fences, in exactly this shape:
{"days":[{"dayIndex":1,"workoutName":"Push","exercises":[{"name":"Barbell Bench Press","sets":4,"reps":"6-8","rest":150,"notes":"","targetLoadLbs":185}]}],"cycleLength":7,"changes":[{"type":"removed|added|moved|modified","detail":"one short sentence"}],"summary":"one short sentence describing the whole change"}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  let raw = "";
  for (const block of message.content) {
    if (block.type === "text") raw += block.text;
  }

  const parsed = EditedRoutineSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    // Which field failed, logged because Hobby keeps runtime logs for an hour
    // and a user report always arrives after that window.
    console.error("[edit-routine] schema rejected:", parsed.error.issues.slice(0, 5));
    throw new ApiError(502, "Fit Bot couldn't apply that change. Please try again.");
  }

  return Response.json({
    routineId: routine.id,
    routineName: routine.name,
    before: current,
    after: parsed.data,
  });
});
