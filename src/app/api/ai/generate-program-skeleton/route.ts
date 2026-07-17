import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import { enforceDailyQuota } from "@/lib/api/rate-limit";
import { SkeletonSchema } from "@/lib/program-schema";
import { muscleVocabularyForPrompt } from "@/lib/muscle-groups";
import { exerciseCatalogPromptBlock } from "@/lib/api/exercise-catalog-prompt";

// Stage 1 of the segmented program builder: one fast Sonnet call that lays out
// the whole macrocycle (the distinct workouts + their rotation cycle, phases,
// deloads, anchor lifts + STRUCTURED linear-progression params). This is where
// program-wide coherence lives; the
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
  distinctWorkouts: z.number().int().min(3).max(8),
  programLength: z.number().int().min(7).max(180),
  structureNotes: z.string().max(500).default(""),
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
  const catalogBlock = await exerciseCatalogPromptBlock();

  const prompt = `You are an expert strength coach designing the STRUCTURE of a ${input.programLength}-day (${durationWeeks}-week) ${input.focus.join(" + ")} training program. You are laying out the macrocycle skeleton only — the per-week loads are computed deterministically afterward and per-phase accessory variety is authored later, so keep this focused and coherent.

USER PROFILE:
- Experience: ${input.experience}
- Distinct workouts to rotate through: ${input.distinctWorkouts}
- Equipment: ${input.equipment.join(", ")}
- Additional goals: ${input.extras.length ? input.extras.join(", ") : "none"}
${input.structureNotes.trim() ? `- Structure notes from the user (honor these when shaping the rotation and rest): ${input.structureNotes.trim()}` : ""}
${input.imbalanceMuscles.length ? `- Bring up these muscles: ${input.imbalanceMuscles.join(", ")}. Notes: ${input.imbalanceNotes}` : ""}
${input.injuryDetails.length ? `- Train around: ${input.injuryDetails.join(", ")}. Notes: ${input.injuryNotes}` : ""}

Design:
- Exactly ${input.distinctWorkouts} DISTINCT workouts the user rotates through (e.g. "Push", "Pull", "Legs", "Upper A"). These are NOT tied to weekdays; they repeat on a rotating cycle. Give each a short "label".
- A rotating "cycle": an array where each entry is either a workout index (0-based, into your workouts array) or -1 for a REST day. The cycle repeats back-to-back for the whole program, so it defines how often each workout recurs. Include every workout at least once per cycle and place rest sensibly (typically 1 rest after every 2-4 training days). Keep the cycle compact (roughly ${input.distinctWorkouts}-${input.distinctWorkouts + 3} days). Example for 3 workouts training then resting: [0,1,2,-1].
- For EACH workout, choose 1-3 ANCHOR lifts (the key compound movements that drive progression). Each anchor gets a linear progression: a realistic starting load in POUNDS for a ${input.experience} lifter with this equipment (use 0 for bodyweight or unloaded movements), a per-week load increment in pounds (typically 2.5-10 lb for upper body, 5-15 lb for lower body; 0 for bodyweight), the fixed sets, and a rep prescription string (e.g. "5", "8-12"). Only pick anchors the equipment allows; respect injuries.
- ${durationWeeks >= 6 ? `Lay out 2-4 training PHASES (e.g. Foundation, Strength, Hypertrophy, Peak) that tile weeks 1..${durationWeeks} with no gaps or overlaps.` : `Lay out 1-2 training PHASES that tile weeks 1..${durationWeeks}.`}
- Include a deload roughly every 4-6 weeks (list those 1-indexed week numbers in deloadWeeks; deloadLoadFactor ~0.9). ${durationWeeks < 4 ? "For a short program, deloadWeeks may be empty." : ""}
- Every muscleGroups value (on workouts and anchorLifts) MUST use ONLY these names (a coarse group, or one of its listed specifics): ${muscleVocabularyForPrompt()}. Prefer the coarse group; do not invent other muscle names.
${catalogBlock}

Return ONLY valid JSON, no preamble and no markdown fences, in exactly this shape:
{"name":"string","durationWeeks":${durationWeeks},"workouts":[{"label":"Push","muscleGroups":["Chest","Shoulders"],"anchorLifts":[{"name":"Barbell Bench Press","muscleGroups":["Chest"],"exerciseType":"weight_reps","isAssisted":false,"restSeconds":180,"progression":{"scheme":"linear","startLoadLbs":135,"incrementLbs":5,"sets":4,"reps":"5"}}]}],"cycle":[0,1,2,-1],"phases":[{"name":"Foundation","focus":"hypertrophy","startWeek":1,"endWeek":4}],"deloadWeeks":[4],"deloadLoadFactor":0.9}`;

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
  // The exact program length in days is authoritative from the wizard, not the
  // model; inject it so the assembler builds exactly this many days.
  return { ...result.data, durationDays: input.programLength };
});
