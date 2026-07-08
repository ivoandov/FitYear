import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import { GeneratedWorkoutSchema } from "@/lib/workout-schema";

// A single workout is a small generation that finishes well under the Hobby 60s
// function limit even on Opus, so this is a plain non-streaming call (no
// segmentation needed — that's only the multi-week program builder). maxDuration
// is raised from the 10s default so a slightly slower model call still lands.
export const maxDuration = 60;

const InputSchema = z.object({
  prompt: z.string().min(1).max(2000),
  // Optional convenience hints from the segmented quick-controls. The model
  // parses the freeform prompt regardless; these just nudge it.
  options: z
    .object({
      durationMinutes: z.number().int().min(5).max(240).optional(),
      location: z.string().max(60).optional(), // "Home" | "Gym" | free text
      intensity: z.string().max(60).optional(), // "Moderate" | "High" | free text
    })
    .optional(),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new ApiError(502, "Fit Bot didn't return a workout. Please try again.");
  }
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new ApiError(502, "Fit Bot returned an invalid workout. Please try again.");
  }
}

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  // Cap paid Opus spend per user per day (counts before the model call).
  await enforceDailyQuota(user.id, "generate-workout", 20);
  const input = InputSchema.parse(await request.json());

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const hintParts: string[] = [];
  if (input.options?.durationMinutes)
    hintParts.push(`Target duration: about ${input.options.durationMinutes} minutes.`);
  if (input.options?.location)
    hintParts.push(`Location / equipment: ${input.options.location}.`);
  if (input.options?.intensity)
    hintParts.push(`Intensity: ${input.options.intensity}.`);
  const hints = hintParts.length
    ? `\n\nADDITIONAL PREFERENCES:\n- ${hintParts.join("\n- ")}`
    : "";

  const prompt = `You are an expert strength and conditioning coach. Design ONE effective single workout for this request.

USER REQUEST:
"${input.prompt}"${hints}

Requirements:
- Honor the requested duration, equipment/location, target muscles, and intensity. Size the number of exercises and sets so the session realistically fits the time, including rest.
- Be creative and effective. You are NOT limited to any fixed exercise library; choose the best movements for the goal, including variations and unilateral/accessory work.
- Respect any injuries or limitations the user mentions; never program something that would aggravate them.
- For each exercise give: name; the muscle groups it trains; exerciseType ("weight_reps" for lifting/bodyweight strength, "distance_time" for cardio/carries measured by distance or time); isAssisted (true ONLY for assisted-machine movements such as assisted pull-ups); sets; a reps prescription as a string ("8-12", "AMRAP", "30s"); rest in seconds; and a short coaching note (may be empty).
- Give the workout a short motivating name, an estimatedMinutes, the primary targetMuscles, and the equipment used.

Return ONLY valid JSON, no preamble and no markdown fences, in exactly this shape:
{"name":"string","estimatedMinutes":60,"targetMuscles":["string"],"equipment":["string"],"exercises":[{"name":"string","muscleGroups":["string"],"exerciseType":"weight_reps","isAssisted":false,"sets":3,"reps":"8-12","rest":90,"notes":"string"}]}`;

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
  const result = GeneratedWorkoutSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      502,
      "Fit Bot's workout was incomplete. Please try again.",
    );
  }
  return result.data;
});
