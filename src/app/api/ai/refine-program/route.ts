import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { exerciseCatalogPromptBlock } from "@/lib/api/exercise-catalog-prompt";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import { PhaseVarietySchema, SkeletonSchema } from "@/lib/program-schema";
import { muscleVocabularyForPrompt } from "@/lib/muscle-groups";

/**
 * Change a program that has not been saved yet, by asking for it.
 *
 * Ivo, 2026-09-22, after running the builder end to end: "This needs to be a
 * collaborative effort with FitBot. The user needs to feel like they are
 * conversing and iterating and have the full ability to see what FitBot is
 * making, recommend any changes, and make any tweaks before the routine is
 * saved." The builder used to save the moment it finished generating and then
 * show a list of day names, so the only way to change anything was to accept a
 * program you could not read and go hunting in the editor.
 *
 * THIS EDITS THE STRUCTURE, NOT THE EXPANDED DAYS, and that is the whole
 * design. An assembled program is every day of every week with its climbed
 * loads - up to 400 days. Sending that to a model and asking for it back would
 * be enormous, slow, truncatable, and would put the progression arithmetic in
 * the model's hands. The skeleton (the distinct workouts, their anchor lifts and
 * the rotation) plus the per-phase accessories are the part a person actually
 * means when they say "swap the squat" or "make day 3 shorter"; the client
 * re-runs `assembleProgram` afterwards, so every week is recomputed
 * deterministically, exactly as it was at build time.
 *
 * Nothing here writes. The program does not exist in the database until the
 * user presses save.
 */

// One conversational refine = one Opus call over a structure, not a whole
// program. 300s is this project's real ceiling (Vercel PRO).
export const maxDuration = 300;

const InputSchema = z.object({
  skeleton: SkeletonSchema,
  variety: z.array(PhaseVarietySchema),
  instruction: z.string().min(1).max(2000),
  /** What they asked for originally, so a refine does not undo the brief. */
  context: z.string().max(4000).default(""),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new ApiError(502, "FitBot didn't return an update. Please try again.");
  }
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new ApiError(502, "FitBot returned an invalid update. Please try again.");
  }
}

const OutputSchema = z.object({
  skeleton: SkeletonSchema,
  variety: z.array(PhaseVarietySchema),
  summary: z.string().default("Updated the program."),
});

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  // Same ceiling as refining a workout: this is a conversation, so it has to
  // allow many turns, and each one is a single call.
  await enforceDailyQuota(user.id, "refine-program", 40);
  const input = InputSchema.parse(await request.json());

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const catalogBlock = await exerciseCatalogPromptBlock();

  const prompt = `You are an expert strength and conditioning coach revising a program you built for this user. They are looking at it and asking for a change before they commit to it.

WHAT THEY ASKED FOR ORIGINALLY: "${input.context}"

THE PROGRAM'S STRUCTURE (JSON). \`workouts\` are the distinct sessions they rotate through and \`cycle\` is the rotation, where -1 is a rest day. \`variety\` holds the accessory exercises for each phase, one entry per phase, matched to a workout by \`label\`:
${JSON.stringify({ skeleton: input.skeleton, variety: input.variety })}

THEIR CHANGE REQUEST:
"${input.instruction}"

Apply it. Rules that keep this program valid:
- Return the COMPLETE structure back, not a patch, with everything they did not ask to change left exactly as it is.
- Keep \`durationWeeks\`, \`durationDays\` and the phase boundaries unless they asked to change the length.
- \`cycle\` entries index into \`workouts\`; -1 is rest. If you add or remove a workout, fix every index so none points past the end.
- Every entry in \`variety\` must keep one entry per phase, and each day's \`label\` must match a workout's \`label\`, or its accessories are dropped on assembly.
- Anchor lifts carry the progression (start load, increment, sets, reps). Accessories carry no load. Keep that split.
- Respect any injury or limitation they mention: swap out anything that would aggravate it rather than leaving it in with a note.
- Reps are free text ("5", "8-12", "AMRAP"), never a number.
- Muscle groups must come from this list: ${muscleVocabularyForPrompt()}
${catalogBlock}

Return ONLY valid JSON, no preamble and no markdown fences, in exactly this shape:
{"skeleton":{ ...the full revised skeleton... },"variety":[ ...one entry per phase... ],"summary":"one short sentence, plain and specific, saying what you changed"}`;

  const message = await client.messages.create({
    model: "claude-opus-4-8",
    // A whole structure comes back, not a diff: several workouts with their
    // anchors plus the accessories for every phase.
    max_tokens: 16384,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = OutputSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    // Log WHICH field was rejected: runtime logs are short-lived and a user
    // report always arrives after the window.
    console.error("[ai/refine-program] rejected model output:", parsed.error.issues.slice(0, 5));
    throw new ApiError(502, "FitBot's change didn't come back in a usable shape. Try asking again.");
  }

  // The program's length is the user's, not the model's: a refine that quietly
  // stretched a 4-week block to 8 would be changing something they did not ask
  // about, and the assembler builds exactly durationDays days.
  const skeleton = {
    ...parsed.data.skeleton,
    durationDays: input.skeleton.durationDays,
    durationWeeks: input.skeleton.durationWeeks,
  };

  return Response.json({ skeleton, variety: parsed.data.variety, summary: parsed.data.summary });
});
