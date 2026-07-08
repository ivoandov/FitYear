import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import {
  GeneratedWorkoutSchema,
  RefinedWorkoutSchema,
} from "@/lib/workout-schema";

// One conversational refine = one small, fast Opus call. Preview-only: nothing
// is persisted until Start. See FITBOT_TECH_SPEC.md section 1.4.
export const maxDuration = 60;

const InputSchema = z.object({
  workout: GeneratedWorkoutSchema,
  instruction: z.string().min(1).max(1000),
  originalPrompt: z.string().max(2000).default(""),
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
  await enforceDailyQuota(user.id, "refine-workout", 40);
  const input = InputSchema.parse(await request.json());

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are an expert strength and conditioning coach refining a workout you built for this user.

ORIGINAL REQUEST: "${input.originalPrompt}"

CURRENT WORKOUT (JSON):
${JSON.stringify(input.workout)}

USER'S CHANGE REQUEST:
"${input.instruction}"

Apply the requested change. You may substitute exercises freely (you are NOT limited to any fixed library) and you MUST respect any injury or constraint the user mentions, swapping out anything that would aggravate it. Keep every exercise the user did NOT ask to change exactly as it was, in the same order. Preserve the overall duration and target focus unless the user asked to change them. Each exercise keeps the same shape as in the current workout (name, muscleGroups, exerciseType, isAssisted, sets, reps, rest, notes).

Return ONLY valid JSON, no preamble and no markdown fences, in exactly this shape:
{"workout":{ ...the full revised workout, same shape as the current workout... },"changes":[{"type":"swap|add|remove|modify","name":"resulting exercise name","previousName":"prior name if a swap or modify","reason":"short why"}],"summary":"one short sentence describing what changed"}`;

  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  let raw = "";
  for (const block of message.content) {
    if (block.type === "text") raw += block.text;
  }

  const parsed = extractJson(raw);
  const result = RefinedWorkoutSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      502,
      "Fit Bot couldn't apply that change. Please try again.",
    );
  }
  return result.data;
});
