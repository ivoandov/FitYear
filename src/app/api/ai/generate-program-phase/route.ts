import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import { verifyBuildToken } from "@/lib/api/build-token";
import { PHASE_CALL_DAILY_LIMIT } from "@/lib/api/ai-limits";
import { SkeletonSchema, PhaseVarietySchema } from "@/lib/program-schema";
import { muscleVocabularyForPrompt } from "@/lib/muscle-groups";
import { exerciseCatalogPromptBlock } from "@/lib/api/exercise-catalog-prompt";

// Stage 2 of the segmented program builder: ONE fast Sonnet call per skeleton
// phase that authors that phase's exercise variety — a phase-flavored workout
// name + accessory exercises per workout — layered on top of the anchor lifts
// (whose per-week loads are already computed deterministically). One phase's
// worth of output is small, so this stays well under the 60s Hobby budget.
//
// A build costs ONE quota unit, charged at the skeleton call (FITBOT_TECH_SPEC
// 2.5), so this route deliberately does not re-charge it. It is not, however,
// free to call: `buildToken` proves a metered skeleton call happened, names the
// caller, and bounds `phaseIndex`, so a phase call cannot exist without a
// charged build behind it. The daily ceiling below is a second line of defence
// sized so a legitimate builder can never reach it (see the invariant test in
// src/lib/api/__tests__/build-quota.test.ts).
export const maxDuration = 60;

const InputSchema = z.object({
  skeleton: SkeletonSchema,
  phaseIndex: z.number().int().min(0),
  buildToken: z.string().min(1).max(500),
  equipment: z.array(z.string().max(100)).min(1).max(50),
  experience: z.enum(["Beginner", "Intermediate", "Advanced", "Competitive"]),
  // Every free-text field is capped: the quota counts CALLS, not tokens, so an
  // uncapped field let one quota unit buy an arbitrarily large prompt.
  extras: z.array(z.string().max(200)).max(50).default([]),
  imbalanceMuscles: z.array(z.string().max(100)).max(50).default([]),
  imbalanceNotes: z.string().max(1000).default(""),
  injuryDetails: z.array(z.string().max(200)).max(50).default([]),
  injuryNotes: z.string().max(1000).default(""),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new ApiError(502, "Fit Bot didn't return this phase. Please retry the phase.");
  }
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new ApiError(502, "Fit Bot returned an invalid phase. Please retry the phase.");
  }
}

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const input = InputSchema.parse(await request.json());

  // Proves a metered skeleton call issued this build, for THIS user, recently.
  const tokenPhaseCount = verifyBuildToken(input.buildToken, user.id);
  if (input.phaseIndex >= tokenPhaseCount) {
    throw new ApiError(400, "That program phase does not exist.");
  }
  await enforceDailyQuota(user.id, "generate-program-phase", PHASE_CALL_DAILY_LIMIT);

  const phase = input.skeleton.phases[input.phaseIndex];
  if (!phase) {
    throw new ApiError(400, "That program phase does not exist.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const catalogBlock = await exerciseCatalogPromptBlock();

  // Compact workout summary so the model knows each workout's focus + which
  // anchors already exist (so accessories complement rather than duplicate them).
  const workoutSummary = input.skeleton.workouts
    .map((d) => {
      const anchors = d.anchorLifts.map((a) => a.name).join(", ") || "none";
      const muscles = d.muscleGroups.join(", ") || "full body";
      return `- "${d.label}" (${muscles}); anchor lifts already programmed: ${anchors}`;
    })
    .join("\n");

  const prompt = `You are an expert strength coach filling in the ACCESSORY variety for one phase of a ${input.skeleton.durationWeeks}-week ${input.skeleton.name} program.

PHASE: "${phase.name}" — focus: ${phase.focus} — weeks ${phase.startWeek} to ${phase.endWeek}.

USER PROFILE:
- Experience: ${input.experience}
- Equipment: ${input.equipment.join(", ")}
- Additional goals: ${input.extras.length ? input.extras.join(", ") : "none"}
${input.imbalanceMuscles.length ? `- Bring up these muscles: ${input.imbalanceMuscles.join(", ")}. Notes: ${input.imbalanceNotes}` : ""}
${input.injuryDetails.length ? `- Train around: ${input.injuryDetails.join(", ")}. Notes: ${input.injuryNotes}` : ""}

The distinct workouts (anchor lifts are ALREADY programmed — do NOT repeat them):
${workoutSummary}

For EACH workout above, author:
- workoutName: a short, phase-appropriate name (e.g. "${phase.name} Push", "Upper Power", "Lower Hypertrophy").
- accessories: 2-4 accessory/isolation exercises that COMPLEMENT the workout's anchors and suit this phase's ${phase.focus} focus, the equipment, and any injuries. Do not repeat the anchor lifts. Each accessory has: name; the muscleGroups it trains; exerciseType ("weight_reps" for lifting/bodyweight, "distance_time" for cardio/carries measured by distance or time); sets; a reps prescription string ("8-12", "AMRAP", "30s"); rest in seconds; and a short coaching note (may be empty).
- muscleGroups MUST use ONLY these names (a coarse group, or one of its listed specifics): ${muscleVocabularyForPrompt()}. Prefer the coarse group; do not invent other muscle names.
${catalogBlock}

Return ONLY valid JSON, no preamble and no markdown fences. Include EVERY workout, matching each "label" exactly, in this shape:
{"days":[{"label":"Push","workoutName":"Push Power","accessories":[{"name":"Incline Dumbbell Press","muscleGroups":["Chest"],"exerciseType":"weight_reps","sets":3,"reps":"8-12","rest":90,"notes":""}]}]}`;

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

  const parsed = extractJson(raw);
  const result = PhaseVarietySchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(502, "Fit Bot's phase was incomplete. Please retry the phase.");
  }
  return { phaseIndex: input.phaseIndex, variety: result.data };
});
