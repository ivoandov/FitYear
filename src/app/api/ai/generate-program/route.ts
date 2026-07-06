import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { enforceDailyQuota } from "@/lib/api/rate-limit";

// Streaming response — Vercel keeps the connection alive as bytes flow, and
// the client gets immediate progress instead of a 60s blank wall. Persistence
// happens in /api/ai/save-program once the client has the full JSON.
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

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();
    // Cap paid Anthropic spend per user per day (counts before the model call).
    await enforceDailyQuota(user.id, "generate-program", 15);
    const input = InputSchema.parse(await request.json());

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 },
      );
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

    // Sonnet 4.6 is roughly 3-5x faster than Opus 4.7 for structured JSON
    // generation and writes solid programs. Lets us stay inside the 60s
    // function budget on Hobby. Bump to Opus once we move to Pro/Fluid.
    const anthropicStream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (e) {
    if (e instanceof ApiError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    console.error("[generate-program]", e);
    const message = e instanceof Error ? e.message : "Internal Server Error";
    return Response.json({ error: message }, { status: 500 });
  }
}
