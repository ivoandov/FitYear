import { requireUser } from "@/lib/api/auth";
import { handle } from "@/lib/api/handler";
import {
  clearConversation,
  loadConversation,
} from "@/lib/api/coach-conversation";
import { transcriptToTurns } from "@/lib/coach-transcript";

/**
 * The running conversation, for the chat page to pick up where it left off.
 *
 * GET returns RENDERED turns rather than the raw Anthropic message array. The
 * page has no business parsing tool_use blocks to draw a bubble, and the raw
 * transcript is several times the size - most of it tool results the reader
 * never sees. The model's copy still round-trips server-side, where it belongs.
 *
 * DELETE starts a fresh conversation. It deliberately does NOT touch
 * `coach_notes`: wanting a clean thread is not the same as wanting the coach to
 * forget your injury, and conflating the two would make starting a new
 * conversation quietly destructive. Memory is managed on its own screen.
 */

export const GET = handle(async () => {
  const { user } = await requireUser();
  const messages = await loadConversation(user.id);
  return Response.json({ turns: transcriptToTurns(messages) });
});

export const DELETE = handle(async () => {
  const { user } = await requireUser();
  await clearConversation(user.id);
  return Response.json({ ok: true });
});
