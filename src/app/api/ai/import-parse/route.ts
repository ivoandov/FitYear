import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import { ImportedPlanSchema, planExerciseNames } from "@/lib/import-schema";
import { muscleVocabularyForPrompt } from "@/lib/muscle-groups";

/**
 * Stage 1 of import: turn a pasted plan into a structured one.
 *
 * The input is deliberately unconstrained - a plain-text program, a rich-text
 * paste that still carries markup, a JSON export from another tracker, or
 * something an LLM wrote. Parsing that with rules would be endless, so the
 * model normalizes it into lib/import-schema and the deterministic work
 * (matching exercises to the catalog, creating the missing ones, writing rows)
 * happens in /api/import/commit.
 *
 * Split for the same reason the program builder is split: the slow model call
 * and the DB writes must not share one function invocation budget.
 *
 * This route WRITES NOTHING. It is safe to re-run, and the user sees a preview
 * before anything is created.
 *
 * NOTE: this prompt deliberately does NOT inject exerciseCatalogPromptBlock(),
 * unlike the four FitBot prompts. Showing the model the catalog made it snap
 * imported names onto library entries, and it snapped WRONG - a verification
 * run turned "Incline dumbbell press" into "Incline Dumbbell Curl", which would
 * have logged the user against the wrong exercise. Matching is the commit
 * route's job, where lib/exercise-match does it deterministically at a 0.8
 * threshold; that needs the author's ORIGINAL wording to work from.
 */
export const maxDuration = 60;

/** Import parses per user per UTC day. Counts CALLS, so the input is capped. */
const IMPORT_PARSE_DAILY_LIMIT = 30;

/** ~24k characters is a very long program and still far inside the context. */
const MAX_INPUT_CHARS = 24_000;

const InputSchema = z.object({
  text: z.string().min(10).max(MAX_INPUT_CHARS),
  // "auto" lets the model decide whether this is one session or a program.
  mode: z.enum(["auto", "workout", "routine"]).default("auto"),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new ApiError(502, "Couldn't read a workout out of that. Try trimming it down.");
  }
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new ApiError(502, "Couldn't read a workout out of that. Try trimming it down.");
  }
}

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  await enforceDailyQuota(user.id, "import-parse", IMPORT_PARSE_DAILY_LIMIT);
  const input = InputSchema.parse(await request.json());

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const shapeInstruction =
    input.mode === "workout"
      ? `The user says this is ONE workout. Return kind "workout".`
      : input.mode === "routine"
        ? `The user says this is a MULTI-DAY program. Return kind "routine".`
        : `Decide which this is. If it describes a single session, return kind "workout". If it describes several distinct days, a weekly split or a multi-week program, return kind "routine".`;

  const prompt = `You are converting a training plan that came from somewhere else into FitYear's format. The input may be plain text, pasted rich text with leftover markup, a JSON export from another app, or something written by another AI. Read it carefully and convert it faithfully.

${shapeInstruction}

RULES:
- Convert ONLY what is there. Do NOT invent exercises, extra days, or a longer program than described. If the plan lists 4 exercises, return exactly those 4.
- TRANSCRIBE each exercise name EXACTLY as the author wrote it. Do not substitute a similar movement, do not "correct" it, and do not swap it for a name you think this app uses. "Incline dumbbell press" stays "Incline dumbbell press" - it is NOT a curl. Matching names to the user's library happens afterwards, deterministically, and it needs the original wording to do that correctly.
- "sets" is a whole number. "reps" is a PRESCRIPTION STRING exactly as written ("5", "8-12", "AMRAP", "30s", "each side"). "rest" is SECONDS as a number (convert "2 min" to 120; if unstated use 90).
- exerciseType MUST be exactly "weight_reps" (anything counted in sets and reps, including bodyweight) or "distance_time" (anything measured by distance or time: runs, rows, carries, sled work). Never invent another value.
- muscleGroups MUST use ONLY these names: ${muscleVocabularyForPrompt()}. Use the coarse group unless the plan is specific. If the plan says nothing, infer the obvious one.
- Put any per-exercise coaching detail (tempo, RPE, "last set to failure") into "notes", not into the name.
- For a routine: give every day a 1-indexed "dayIndex" counting from the start of the program, a short "workoutName" (e.g. "Push A", "Lower Body"), and include REST days as entries with "isRest": true and an empty exercises array. "cycleLength" is how many days one full rotation covers before it repeats, INCLUDING rest days.

Return ONLY valid JSON, no preamble and no markdown fences.

For a single workout:
{"kind":"workout","name":"Upper Body A","exercises":[{"name":"Barbell Bench Press","muscleGroups":["Chest"],"exerciseType":"weight_reps","sets":4,"reps":"5","rest":180,"notes":""}]}

For a program:
{"kind":"routine","name":"5-Day Split","cycleLength":7,"days":[{"dayIndex":1,"workoutName":"Push","isRest":false,"exercises":[{"name":"Overhead Press","muscleGroups":["Shoulders"],"exerciseType":"weight_reps","sets":3,"reps":"8-12","rest":120,"notes":""}]},{"dayIndex":2,"workoutName":"Rest","isRest":true,"exercises":[]}]}

THE PLAN TO CONVERT:
"""
${input.text}
"""`;

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });

  let raw = "";
  for (const block of message.content) {
    if (block.type === "text") raw += block.text;
  }

  const parsed = ImportedPlanSchema.safeParse(extractJson(raw));
  if (!parsed.success) {
    // Log which field failed - runtime logs are short-lived on Hobby, so a user
    // report otherwise arrives long after the evidence is gone.
    console.error(
      "[ai/import-parse] schema rejected model output:",
      JSON.stringify(parsed.error.issues.slice(0, 10)),
    );
    throw new ApiError(
      502,
      "That didn't come through as a workout I could read. Try pasting just the plan itself.",
    );
  }

  return {
    plan: parsed.data,
    exerciseNames: planExerciseNames(parsed.data),
  };
});
