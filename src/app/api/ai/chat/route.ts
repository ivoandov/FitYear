import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, ApiError } from "@/lib/api/auth";
import { parseTimeZone } from "@/lib/api/timezone";
import { runReadTool } from "@/lib/ai/fitbot-reads";
import {
  ALL_TOOLS,
  buildProposalRequest,
  isMemoryTool,
  isProposalTool,
} from "@/lib/ai/fitbot-tools";
import { runMemoryTool } from "@/lib/ai/fitbot-memory";
import { loadCoachNotes } from "@/lib/api/coach-notes";
import { loadConversation, saveConversation } from "@/lib/api/coach-conversation";
import { renderCoachMemory } from "@/lib/coach-notes";
import { localDateKeyInZone } from "@/lib/date";

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
 * **It remembers you.** Two different mechanisms, and the distinction matters.
 * `coach_notes` holds durable FACTS - goals, injuries, agreements - which are
 * rendered into the system prompt on every turn with no tool call, so they cost
 * nothing to consult and are simply always known. `coach_conversations` holds
 * the running TRANSCRIPT so a conversation resumes rather than restarts. The
 * transcript is trimmed as it grows and the facts are not, which is the right
 * way round: what matters long-term has been written down as a fact, so trimming
 * costs the wording of an old exchange and not the knowledge from it.
 *
 * This replaced client-held history, which meant closing the tab erased the
 * conversation. The old reasoning - that a server store is a table and a cleanup
 * job to solve a problem the stateless API does not have - was correct about the
 * cost and wrong about the problem. A coach that cannot remember yesterday is
 * not a coach.
 *
 * **It streams.** The edge proxy has its own patience and a multi-step tool loop
 * that returns nothing until it is finished can exhaust it. Streaming keeps
 * bytes moving.
 *
 * The budget here is 300 seconds, not 60: this project is on Vercel PRO, which
 * the repo docs had wrong as Hobby for long enough that the mistake was shaping
 * real decisions - this route's reasoning depth among them.
 */
export const maxDuration = 300;

/**
 * How many model round trips one user message may cost.
 *
 * Not a cost control - Ivo asked for this uncapped for now - but a guard
 * against a loop that will not settle. There is real room now (300s), so this
 * is back to where it was before a 60-second limit that did not exist forced it
 * down.
 */
const MAX_ITERATIONS = 6;

/**
 * Reasoning depth, chosen against a MEASURED turn rather than a guess.
 *
 * This was dropped to `low` when the budget was believed to be 60 seconds - a
 * measured turn took 56.9s and the user watched it get killed mid-thought. The
 * budget is actually 300s (Pro, not Hobby), so the depth is back.
 *
 * `medium` rather than the `high` default on purpose: this is a CHAT, and a
 * reply that takes two minutes is its own kind of broken however good it is.
 * The two changes that came out of that investigation - summarised tool
 * payloads and asking for all lookups in one batch - cut the same turn to
 * roughly 37s at `low`, so `medium` now lands comfortably inside a minute.
 */
const EFFORT = "medium" as const;

/**
 * When to stop starting new work.
 *
 * The platform kills the function with no chance to say anything, so the turn
 * ends on its own terms while it still can. Well inside the 300s ceiling: the
 * point is a conversation that answers, not one that is allowed to think for
 * five minutes.
 */
const SOFT_DEADLINE_MS = 150_000;

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

YOU REMEMBER THEM BETWEEN CONVERSATIONS. What you know is listed under YOUR MEMORY below, and this conversation continues from wherever you left off - it is not a fresh start. Use what you know without announcing that you remember it: a coach who knows your shoulder is bad just trains around it, they do not preface every session with a recap.

WHAT TO WRITE DOWN. Call remember the moment you learn something that will still matter in a month: what they are training for, an injury or limitation, the equipment they have, the days they can train, a strong preference, or something the two of you agreed to do. Do not record what you can already read - their workouts, weights and records are all one tool call away, and copying them into memory is noise that crowds out the things that are not readable. If something you know turns out to be wrong or out of date, use update_memory to revise it or forget to drop it; a wrong fact about somebody's body is worse than no fact. Prefer revising over accumulating a second, contradictory version. When you record or drop something, say so in a sentence, so they always know what you are holding.

Anything in your memory marked as stated by them is theirs, not yours: do not rewrite or delete it without asking first. What someone tells you about their own body outranks what you inferred about it.

GATHER IN ONE GO. Ask for every tool you need in a SINGLE batch rather than looking one thing up, thinking, then looking up another. Each extra round trip costs the user several seconds of staring at nothing.

HOW TO OPEN A CONVERSATION ABOUT THEIR TRAINING. Read before you talk. get_active_program tells you what they are running AND how their completed sessions differ from the plan; get_training_summary tells you which muscle groups are behind their own baseline. Lead with what you actually noticed, specifically, with numbers. "You have added biceps work on 2 of your last 3 Day 1 sessions" is useful. "How is your training going?" wastes their time.

CHANGING ANYTHING. You do not make changes yourself. When you want something changed, call the matching propose_ tool: the app shows the user exactly what you are asking for and they approve, reject, or tell you to adjust it. So propose concrete, complete changes rather than describing them vaguely, and never claim something is done - say what you are proposing.

Before proposing, be sure it is what they want. If the request is ambiguous, ask one short question first. If you have noticed something and are suggesting it unprompted, say what you saw and ask whether to make the change, rather than firing a proposal at them cold.

RULES THAT KEEP THE DATA HONEST.
- A hard constraint in your memory is a rule, not a preference. Never propose anything that violates one, and if they ask for something that does, say why before doing it rather than silently obeying or silently refusing.
- dayIndex is a position in the ROTATION, starting at 1, and the GAPS ARE THE REST DAYS. A 4-day week inside a 7-day cycle is dayIndex 1, 3, 5, 6 - never 1, 2, 3, 4, which would stack four training days together and rest for three.
- Reps are free text and stay free text: "6-8", "AMRAP", "30s" are all valid. Never turn a range into a single number.
- Every weight in the data is POUNDS. If they talk in kilos, convert, and say which unit you mean.
- Search the exercise catalog before proposing any exercise. It is shared by every user, so reuse the exact existing name; only propose creating one when nothing there fits.
- A muscle group being "behind" is measured against THEIR OWN average, not an ideal. Never nudge about Cardio or PT: somebody with no physio logged does not have an injury.
- When a routine change would affect a program they are currently running, follow it with propose_program_resync so the workouts already on their calendar can follow the change. If the change dropped a day, ask whether its scheduled sessions should be removed or left alone before choosing removeOrphaned.

HOW TO WRITE. Plain, direct, and SHORT: a few tight paragraphs or a short list, not an essay. Lead with the finding. Say the two or three things that matter and stop; the user can always ask for more.  You are a knowledgeable training partner, not a wellness brand: no hype, no emoji, no exclamation marks, no "great question". Give a recommendation rather than a menu of options, and say when you are unsure. Never invent a number - if you did not read it from a tool, you do not know it.`;

type Event = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const { user } = await requireUser();
  const input = InputSchema.parse(await request.json());
  const tz = parseTimeZone(request.nextUrl.searchParams.get("tz"));

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ApiError(500, "AI is not configured");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const todayKey = localDateKeyInZone(new Date(), tz);

  const [notes, stored] = await Promise.all([
    loadCoachNotes(user.id),
    loadConversation(user.id),
  ]);

  // The stored transcript is authoritative: it is written at the end of every
  // turn, so it cannot be behind the client. The one exception is a
  // conversation that was already in progress when persistence shipped, which
  // has client history and no stored row - honour the client's copy then rather
  // than making that conversation appear to reset itself.
  const prior =
    stored.length > 0
      ? (stored as Anthropic.MessageParam[])
      : ((input.history ?? []) as Anthropic.MessageParam[]);

  const messages: Anthropic.MessageParam[] = [
    ...prior,
    { role: "user", content: input.message },
  ];

  const memory = renderCoachMemory(notes, todayKey);
  // Today's date belongs here rather than in the cached prefix: a coach that
  // does not know what day it is cannot reason about "this week", and baking it
  // into the cached block would serve a stale date for the life of the cache.
  const context = [
    `TODAY IS ${todayKey} (their timezone: ${tz}).`,
    memory ? `YOUR MEMORY OF THIS PERSON\n\n${memory}` : "YOUR MEMORY OF THIS PERSON\n\nEmpty so far. Anything worth keeping, write down with remember as you learn it.",
  ].join("\n\n");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Event) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      const startedAt = Date.now();

      /**
       * Store the transcript, but never at the cost of the reply.
       *
       * A conversation that answered well and failed to save is a small loss;
       * one that threw while saving and lost its answer is a large one. So this
       * swallows its own failure and logs it, which is the same call the read
       * tools make.
       */
      const persist = async (all: Anthropic.MessageParam[]) => {
        try {
          await saveConversation(user.id, all);
        } catch (e) {
          console.error("[ai/chat] could not save transcript:", e);
        }
      };

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          // Stop BEFORE starting a round trip we cannot finish. Being killed by
          // the platform mid-thought is what produced the original symptom: an
          // opening sentence, then nothing, with no error anywhere.
          if (i > 0 && Date.now() - startedAt > SOFT_DEADLINE_MS) {
            send({
              type: "text",
              text: "\n\n(I ran out of time before I could finish that. Ask me to continue and I will pick up where I left off.)",
            });
            break;
          }
          const modelStream = client.messages.stream({
            model: "claude-opus-5",
            max_tokens: 8192,
            // Summarized, not omitted (the default). While the model thinks it
            // emits no text, so on a long turn the page showed a finished
            // sentence and then nothing for the better part of a minute, which
            // is indistinguishable from being broken. A visible summary is the
            // difference between "working" and "hung".
            thinking: { type: "adaptive", display: "summarized" },
            output_config: { effort: EFFORT },
            // TWO blocks, and the order is the point. The instructions and the
            // tool list are byte-identical on every turn, so they are the
            // stable prefix and carry the cache breakpoint. Memory and today's
            // date go AFTER it, uncached, because they change - memory
            // whenever the coach learns something, the date every midnight.
            // Putting them inside the cached block would either invalidate the
            // cache on every note written or serve yesterday's date all day.
            system: [
              { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
              { type: "text", text: context },
            ],
            tools: ALL_TOOLS,
            messages,
          });

          modelStream.on("text", (text) => send({ type: "text", text }));
          // Thinking is where the seconds go on a hard question, and it emits
          // no text of its own. Forwarding the summary is what keeps the page
          // from looking hung while the model works.
          modelStream.on("thinking", (thinking) =>
            send({ type: "thinking", text: thinking }),
          );

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
            if (isMemoryTool(call.name)) {
              // Executes, unlike a proposal. See the header of fitbot-tools.ts
              // for why memory is the one write that does not need approval.
              send({ type: "memory", name: call.name });
              try {
                const message = await runMemoryTool(
                  call.name,
                  (call.input ?? {}) as Record<string, unknown>,
                  { userId: user.id, todayKey },
                );
                results.push({
                  type: "tool_result",
                  tool_use_id: call.id,
                  content: message,
                });
              } catch (e) {
                // Same reasoning as a failed read: returned, not thrown. A
                // conversation should survive failing to write a note down.
                console.error(`[ai/chat] memory ${call.name} failed:`, e);
                results.push({
                  type: "tool_result",
                  tool_use_id: call.id,
                  content: `That did not save: ${(e as Error).message}`,
                  is_error: true,
                });
              }
              continue;
            }

            if (isProposalTool(call.name)) {
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

        await persist(messages);
        send({ type: "done", history: messages });
      } catch (e) {
        // Hobby keeps runtime logs for an hour and a user report always arrives
        // after that window, so the detail goes to the log and a plain sentence
        // goes to the user.
        console.error("[ai/chat] failed:", e);
        // Save what the conversation got to before it broke. Losing the whole
        // exchange because the last round trip failed would make a rate limit
        // feel like the coach forgetting the conversation.
        await persist(messages);
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
