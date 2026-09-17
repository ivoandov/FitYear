/**
 * Keeping a saved conversation both bounded and REPLAYABLE.
 *
 * A stored transcript has to stay valid input to the Messages API, and the
 * rule that makes that hard is pairing: every `tool_use` block in an assistant
 * turn must be answered by a `tool_result` in the next user turn. Slice a
 * transcript at an arbitrary index and you can strand a `tool_result` whose
 * `tool_use` you just dropped, and the very next request 400s - on a
 * conversation the person has been having for weeks, with no way back.
 *
 * So the trim never cuts at a fixed offset. It cuts at the first CLEAN
 * BOUNDARY at or after the offset, where clean means a real user message: one
 * the person typed, not a turn carrying tool results. Starting there, every
 * tool_use kept has its answer and every tool_result kept has its call.
 *
 * Losing the older turns is acceptable only because `coach_notes` exists. The
 * model is instructed to write anything durable there as it goes, so a trim
 * costs the wording of an old conversation and not the knowledge from it. That
 * is the whole reason memory was built before persistence.
 */

/**
 * `role` is a plain string rather than the two literals, because the SDK's own
 * MessageParam admits a third and a narrower type here would force a cast at
 * every call site. Anything that is not "user" or "assistant" is simply not
 * rendered.
 */
export type TranscriptMessage = {
  role: string;
  content: unknown;
};

/**
 * How many messages to keep.
 *
 * Counted in messages rather than tokens on purpose: a token count would be an
 * estimate of a number the API computes differently, and being wrong about it
 * fails a request rather than trimming harder. One exchange with tool use is
 * typically four messages, so this is roughly twenty-five exchanges of verbatim
 * recall, on top of memory that does not expire.
 */
export const MAX_TRANSCRIPT_MESSAGES = 100;

/**
 * Is this a message the person actually typed, rather than a carrier for tool
 * results? Only these are safe places to begin a transcript.
 */
export function isCleanBoundary(message: TranscriptMessage): boolean {
  if (message.role !== "user") return false;
  if (typeof message.content === "string") return true;
  if (!Array.isArray(message.content)) return false;
  // A user turn whose content is an array is usually the tool_result carrier
  // the loop pushes. If any block is a tool_result, its tool_use lives in the
  // assistant turn before it and cutting here would orphan it.
  return !message.content.some(
    (block) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "tool_result",
  );
}

export function trimTranscript(
  messages: TranscriptMessage[],
  max: number = MAX_TRANSCRIPT_MESSAGES,
): TranscriptMessage[] {
  if (messages.length <= max) return messages;

  for (let i = messages.length - max; i < messages.length; i++) {
    if (isCleanBoundary(messages[i])) return messages.slice(i);
  }

  // No clean boundary anywhere in the tail. Keeping an over-long but VALID
  // transcript beats saving a shorter one the API will reject: the next turn
  // trims it again, and a single long conversation is a cost problem where a
  // broken one is a dead feature.
  return messages;
}

/** What the chat page renders for a past turn. */
export type RenderedTurn = { kind: "user" | "bot"; text: string };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * Turn a stored transcript back into something worth looking at.
 *
 * Only what the two of them SAID survives: the tool calls, tool results and
 * thinking blocks are dropped. They were scaffolding that made sense live, as
 * progress, and replaying "Reading your training history" against a
 * conversation from last Tuesday is noise around the part that matters.
 *
 * Proposal cards are deliberately not rebuilt either. A proposal is a live
 * offer with an Approve button, and a stale one would either invite approving
 * something already decided or need a whole resolved-state model to render
 * honestly. The reply text around it carries what was suggested.
 */
export function transcriptToTurns(messages: TranscriptMessage[]): RenderedTurn[] {
  const turns: RenderedTurn[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textOf(message.content);
    if (!text) continue;
    turns.push({ kind: message.role === "user" ? "user" : "bot", text });
  }
  return turns;
}
