import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import { SkeletonSchema } from "@/lib/program-schema";

// Stage 1 of the segmented program builder: one fast Sonnet call that lays out
// the whole macrocycle (split, phases, deloads, anchor lifts + STRUCTURED
// linear-progression params). This is where program-wide coherence lives; the
// per-week loads are then expanded deterministically in code, and per-phase
// variety is authored by separate stage-2 calls. The skeleton is compact, so
// this finishes well under the 60s Hobby budget as a plain non-streaming call.
// This is ALSO where the whole build is counted against the daily quota — the
// per-phase calls do NOT re-charge, so a segmented build costs one unit.
export const maxDuration = 60;

const InputSchema = z.object({
  focus: z.array(z.string()).min(1),
  equipment: z.array(z.string()).min(1),
  experience: z.enum(["Beginner", "Intermediate", "Advanced", "Competitive"]),
  daysPerWeek: z.number().int().min(2).max(7),
  programLength: z.number().int().min(7).max(180),
  extras: z.array(z.string()).default([]),
  imbalanceMuscles: z.array(z.string()).default([]),
  imbalanceNotes: z.string().default(""),
  injuryDetails: z.array(z.string()).default([]),
  injuryNotes: z.string().default(""),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new ApiError(502, "Fit Bot didn't return a program structure. Please try again.");
  }
  try {
    return JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new ApiError(502, "Fit Bot returned an invalid program structure. Please try again.");
  }
}

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  // Count ONE build here (stage 2 per-phase calls don't re-charge).
  await enforceDailyQuota(user.id, "generate-program", 15);
  const input = InputSchema.parse(await request.json());

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const durationWeeks = Math.ceil(input.programLength / 7);

  const prompt = `You are an expert strength coach designing the STRUCTURE of a ${input.programLength}-day (${durationWeeks}-week) ${input.focus.join(" + ")} training program. You are laying out the macrocycle skeleton only — the per-week loads are computed deterministically afterward and per-phase accessory variety is authored later, so keep this focused and coherent.

USER PROFILE:
- Experience: ${input.experience}
- Training days/week: ${input.daysPerWeek}
- Equipment: ${input.equipment.join(", ")}
- Additional goals: ${input.extras.length ? input.extras.join(", ") : "none"}
${input.imbalanceMuscles.length ? `- Bring up these muscles: ${input.imbalanceMuscles.join(", ")}. Notes: ${input.imbalanceNotes}` : ""}
${input.injuryDetails.length ? `- Train around: ${input.injuryDetails.join(", ")}. Notes: ${input.injuryNotes}` : ""}

Design:
- A training split of exactly ${input.daysPerWeek} training days. Give each split day a distinct FULL weekday name ("Monday".."Sunday") — the app maps these to the calendar. Non-training weekdays become rest days automatically; do not include rest days.
- For EACH split day, choose 1-3 ANCHOR lifts (the key compound movements that drive progression). Each anchor gets a linear progression: a realistic starting load in POUNDS for a ${input.experience} lifter with this equipment (use 0 for bodyweight or unloaded movements), a per-week load increment in pounds (typically 2.5-10 lb for upper body, 5-15 lb for lower body; 0 for bodyweight), the fixed sets, and a rep prescription string (e.g. "5", "8-12"). Only pick anchors the equipment allows; respect injuries.
- ${durationWeeks >= 6 ? `Lay out 2-4 training PHASES (e.g. Foundation, Strength, Hypertrophy, Peak) that tile weeks 1..${durationWeeks} with no gaps or overlaps.` : `Lay out 1-2 training PHASES that tile weeks 1..${durationWeeks}.`}
- Include a deload roughly every 4-6 weeks (list those 1-indexed week numbers in deloadWeeks; deloadLoadFactor ~0.9). ${durationWeeks < 4 ? "For a short program, deloadWeeks may be empty." : ""}

Return ONLY valid JSON, no preamble and no markdown fences, in exactly this shape:
{"name":"string","durationWeeks":${durationWeeks},"daysPerWeek":${input.daysPerWeek},"split":[{"dayLabel":"Upper A","dayOfWeek":"Monday","muscleGroups":["Chest","Back"],"anchorLifts":[{"name":"Barbell Bench Press","muscleGroups":["Chest"],"exerciseType":"weight_reps","isAssisted":false,"restSeconds":180,"progression":{"scheme":"linear","startLoadLbs":135,"incrementLbs":5,"sets":4,"reps":"5"}}]}],"phases":[{"name":"Foundation","focus":"hypertrophy","startWeek":1,"endWeek":4}],"deloadWeeks":[4],"deloadLoadFactor":0.9}`;

  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    // Coherence comes from the structured skeleton + deterministic progression,
    // not model deliberation — keep this fast + predictable inside the 60s budget.
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });

  let raw = "";
  for (const block of message.content) {
    if (block.type === "text") raw += block.text;
  }

  const parsed = extractJson(raw);
  const result = SkeletonSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(502, "Fit Bot's program structure was incomplete. Please try again.");
  }
  return result.data;
});
