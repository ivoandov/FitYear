import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { parseTimeZone } from "@/lib/api/timezone";
import { runReadTool } from "@/lib/ai/fitbot-reads";
import { ALL_TOOLS, buildProposalRequest, isWriteTool } from "@/lib/ai/fitbot-tools";

/**
 * A conversation with FitBot that can see the whole app and act on it.
 *
 * Ivo, 2026-09-10, in two messages: there was nowhere in FitYear to simply TALK
 * to FitBot (Home offered a "describe your workout" form and a program builder,
 * both one-shot), and what he actually wanted was "look at the way I've done
 * the active routine workouts to date and update future workouts accordingly...
 * it analyzes, tells me what it sees, and I approve/deny/change what it is
 * going to do."
 *
 * Three things make that work and each is load-bearing:
 *
 * **Reads execute, writes are proposed.** A write tool call ends the turn and
 * hands the client a structured action; the CLIENT performs it, on approval,
 * against the app's own endpoints with the user's session. So an approved
 * change takes the identical code path to the user doing it by hand, keeping
 * exercise-name canonicalisation, the duplicate guard and userId scoping that
 * all live in those handlers. See lib/ai/fitbot-tools.ts.
 *
 * **The transcript is opaque client state.** The full Anthropic message array,
 * tool calls and results included, round-trips through the client. The
 * alternative was a server session store, which is a database table and a
 * cleanup job to solve a problem the stateless API does not have.
 *
 * **It streams.** Hobby gives this function 60 seconds and the edge proxy has
 * its own patience; a multi-step tool loop that returns nothing until it is
 * finished can hit both. Streaming keeps bytes moving, and the iteration cap
 * keeps the whole turn inside the budget.
 */
export const maxDuration = 60;

/**
 * How many model round trips one user message may cost.
 *
 * Not a cost control - Ivo asked for this uncapped for now - but a latency
 * one: every iteration is a model call plus tool reads, and the function has 60
 * seconds total. Hitting the cap ends the turn with whatever was said, which is
 * recoverable; running past the limit is a 504 with nothing to show.
 */
const MAX_ITERATIONS = 6;

/**
 * Effort is pinned BELOW the default for the same reason.
 *
 * `high` (the default) is the better coach, and on an unbounded runtime it is
 * the right call. Inside a 60-second function that also has to make several
 * tool round trips, it is how you get a turn that never finishes. Raise this
 * the day these routes stop living on Hobby.
 */
const EFFORT = "medium" as const;

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.unknown(),
});

const InputSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  /** The prior transcript, exactly as this route last returned it. */
  history: z.array(MessageSchema).max(200).optional(),
});

const SYSTEM = `You are FitBot, the coach inside FitYear, talking to the person whose training data you can read.

WHO YOU ARE TALKING TO. One person, about their own training. You can see everything in their FitYear account through your tools. Look things up rather than asking them to tell you what you could read yourself.

HOW TO OPEN A CONVERSATION ABOUT THEIR TRAINING. Read before you talk. get_active_program tells you what they are running AND how their completed sessions differ from the plan; get_training_summary tells you which muscle groups are behind their own baseline. Lead with what you actually noticed, specifically, with numbers. "You have added biceps work on 2 of your last 3 Day 1 sessions" is useful. "How is your training going?" wastes their time.

CHANGING ANYTHING. You do not make changes yourself. When you want something changed, call the matching propose_ tool: the app shows the user exactly what you are asking for and they approve, reject, or tell you to adjust it. So propose concrete, complete changes rather than describing them vaguely, and never claim something is done - say what you are proposing.

Before proposing, be sure it is what they want. If the request is ambiguous, ask one short question first. If you have noticed something and are suggesting it unprompted, say what you saw and ask whether to make the change, rather than firing a proposal at them cold.

RULES THAT KEEP THE DATA HONEST.
- dayIndex is a position in the ROTATION, starting at 1, and the GAPS ARE THE REST DAYS. A 4-day week inside a 7-day cycle is dayIndex 1, 3, 5, 6 - never 1, 2, 3, 4, which would stack four training days together and rest for three.
- Reps are free text and stay free text: "6-8", "AMRAP", "30s" are all valid. Never turn a range into a single number.
- Every weight in the data is POUNDS. If they talk in kilos, convert, and say which unit you mean.
- Search the exercise catalog before proposing any exercise. It is shared by every user, so reuse the exact existing name; only propose creating one when nothing there fits.
- A muscle group being "behind" is measured against THEIR OWN average, not an ideal. Never nudge about Cardio or PT: somebody with no physio logged does not have an injury.
- When a routine change would affect a program they are currently running, follow it with propose_program_resync so the workouts already on their calendar can follow the change. If the change dropped a day, ask whether its scheduled sessions should be removed or left alone before choosing removeOrphaned.

HOW TO WRITE. Plain, direct, and short. You are a knowledgeable training partner, not a wellness brand: no hype, no emoji, no exclamation marks, no "great question". Give a recommendation rather than a menu of options, and say when you are unsure. Never invent a number - if you did not read it from a tool, you do not know it.`;

type Event = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const { user } = await requireUser();
  const input = InputSchema.parse(await request.json());
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = [
    ...((input.history ?? []) as Anthropic.MessageParam[]),
    { role: "user", content: input.message },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Event) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const modelStream = client.messages.stream({
            model: "claude-opus-5",
            max_tokens: 8192,
            thinking: { type: "adaptive" },
            output_config: { effort: EFFORT },
            // The system prompt and the tool list are byte-identical on every
            // turn, so they are the stable prefix worth caching. The transcript
            // after them is what varies.
            system: [
              { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
            ],
            tools: ALL_TOOLS,
            messages,
          });

          modelStream.on("text", (text) => send({ type: "text", text }));

          const final = await modelStream.finalMessage();
          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason !== "tool_use") break;

          const calls = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          // Every tool_use block must get a tool_result, INCLUDING the write
          // that ends this turn: an assistant turn left with an unanswered
          // tool call makes the next request in this conversation a 400.
          const results: Anthropic.ToolResultBlockParam[] = [];
          let proposed = false;

          for (const call of calls) {
            if (isWriteTool(call.name)) {
              proposed = true;
              const inputObj = call.input as Record<string, unknown>;
              send({
                type: "proposal",
                tool: call.name,
                input: inputObj,
                request: buildProposalRequest(call.name, inputObj),
                summary: String(inputObj.summary ?? "Proposed change"),
              });
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content:
                  "Shown to the user for approval. Nothing has been changed yet; wait for them to tell you what they decided.",
              });
              continue;
            }

            send({ type: "tool", name: call.name });
            try {
              const out = await runReadTool(
                call.name,
                (call.input ?? {}) as Record<string, unknown>,
                { userId: user.id, tz },
              );
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: JSON.stringify(out),
              });
            } catch (e) {
              // Returned, not thrown: a failed read should let the model say so
              // and carry on, not kill the conversation.
              console.error(`[ai/chat] tool ${call.name} failed:`, e);
              results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: `That lookup failed: ${(e as Error).message}`,
                is_error: true,
              });
            }
          }

          // All results in ONE user message. Splitting them teaches the model
          // to stop making parallel calls.
          messages.push({ role: "user", content: results });

          if (proposed) break;
        }

        send({ type: "done", history: messages });
      } catch (e) {
        // Hobby keeps runtime logs for an hour and a user report always arrives
        // after that window, so the detail goes to the log and a plain sentence
        // goes to the user.
        console.error("[ai/chat] failed:", e);
        send({
          type: "error",
          message:
            e instanceof Anthropic.APIError && e.status === 429
              ? "FitBot is rate limited right now. Try again in a moment."
              : "FitBot could not finish that. Please try again.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      // Proxies that buffer would defeat the point of streaming here.
      "x-accel-buffering": "no",
    },
  });
}
