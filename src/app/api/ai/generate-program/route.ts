import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { routines, routineEntries } from "@/lib/db/schema";
import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";

// Hobby plan allows up to 60s; streaming the Anthropic response keeps the
// connection alive while Opus drafts the program (typically 20-45s for a
// 90-day plan).
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

interface GeneratedProgram {
  name: string;
  weeks: Array<{
    weekNum: number;
    days: Array<{
      dayOfWeek: string;
      workoutName: string;
      isRest: boolean;
      exercises: Array<{
        name: string;
        sets: number;
        reps: string;
        rest: number;
        notes?: string;
      }>;
    }>;
  }>;
}

const DAY_INDEX_BY_NAME: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

export const POST = handle(async (request: NextRequest) => {
  const { user } = await requireUser();
  const input = InputSchema.parse(await request.json());

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are an expert fitness coach. Generate a ${input.programLength}-day ${input.focus.join(" + ")} training program.

USER PROFILE:
- Experience: ${input.experience}
- Training days/week: ${input.daysPerWeek}
- Equipment: ${input.equipment.join(", ")}
- Additional goals: ${input.extras.length ? input.extras.join(", ") : "none"}
${input.imbalanceMuscles.length ? `- Muscle imbalances: ${input.imbalanceMuscles.join(", ")}. Notes: ${input.imbalanceNotes}` : ""}
${input.injuryDetails.length ? `- Training around: ${input.injuryDetails.join(", ")}. Notes: ${input.injuryNotes}` : ""}

Return ONLY valid JSON, no preamble:
{
  "name": "string",
  "weeks": [{
    "weekNum": 1,
    "days": [{
      "dayOfWeek": "Monday",
      "workoutName": "string",
      "isRest": false,
      "exercises": [{ "name": "string", "sets": 4, "reps": "5", "rest": 180, "notes": "" }]
    }]
  }]
}

Rules: ${input.daysPerWeek} training days/week, progressive overload every 1-2 weeks,
equipment-appropriate exercises only, ${input.experience}-level volume/intensity.
Cover the full ${input.programLength}-day duration in ${Math.ceil(input.programLength / 7)} weeks.`;

  // Use streaming so we don't hit timeout on long programs
  const stream = await client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });
  const message = await stream.finalMessage();

  // Extract text content
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Anthropic");
  }
  let raw = textBlock.text.trim();
  // Strip markdown code fences if present
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }

  let program: GeneratedProgram;
  try {
    program = JSON.parse(raw);
  } catch (e) {
    console.error("[generate-program] JSON parse failed. Raw:", raw.slice(0, 500));
    throw new Error("Fit Bot returned invalid JSON. Try again.");
  }

  // Persist routine + entries
  const [routine] = await db
    .insert(routines)
    .values({
      userId: user.id,
      name: program.name,
      description: `Built by Fit Bot · ${input.focus.join(" + ")} · ${input.experience}`,
      defaultDurationDays: input.programLength,
      isPublic: false,
    })
    .returning();

  // Each day in each week becomes a routineEntry. dayIndex is 1-based,
  // computed as (weekNum-1)*7 + dayOfWeek index.
  const entries: Array<{
    routineId: string;
    dayIndex: number;
    workoutName: string | null;
    exercises: unknown;
  }> = [];
  for (const week of program.weeks ?? []) {
    for (const day of week.days ?? []) {
      const dow = DAY_INDEX_BY_NAME[day.dayOfWeek] ?? 1;
      const dayIndex = (week.weekNum - 1) * 7 + dow;
      if (day.isRest) continue;
      entries.push({
        routineId: routine.id,
        dayIndex,
        workoutName: day.workoutName,
        exercises: day.exercises,
      });
    }
  }
  if (entries.length) {
    await db.insert(routineEntries).values(entries);
  }

  return {
    routineId: routine.id,
    name: program.name,
    weeksGenerated: program.weeks?.length ?? 0,
    daysGenerated: entries.length,
    program, // include the full program for client preview
  };
});
