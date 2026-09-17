import { describe, it, expect } from "vitest";
import {
  isCleanBoundary,
  transcriptToTurns,
  trimTranscript,
  type TranscriptMessage,
} from "@/lib/coach-transcript";

const said = (role: string, text: string): TranscriptMessage => ({
  role,
  content: text,
});

const toolCall = (id: string): TranscriptMessage => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name: "get_settings", input: {} }],
});

const toolResult = (id: string): TranscriptMessage => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, content: "{}" }],
});

describe("clean boundaries", () => {
  it("counts a typed message as clean", () => {
    expect(isCleanBoundary(said("user", "hello"))).toBe(true);
  });

  it("does NOT count a tool-result carrier as clean", () => {
    // This is the whole point. Cutting here strands the tool_use it answers,
    // and the next request to the API is a 400 on a conversation somebody has
    // been having for weeks.
    expect(isCleanBoundary(toolResult("t1"))).toBe(false);
  });

  it("does not count an assistant turn as clean", () => {
    expect(isCleanBoundary(said("assistant", "hi"))).toBe(false);
  });

  it("counts a user turn of plain content blocks as clean", () => {
    expect(
      isCleanBoundary({ role: "user", content: [{ type: "text", text: "hi" }] }),
    ).toBe(true);
  });
});

describe("trimming", () => {
  it("leaves a short conversation alone", () => {
    const messages = [said("user", "a"), said("assistant", "b")];
    expect(trimTranscript(messages, 10)).toBe(messages);
  });

  it("cuts at a real user message, never mid tool exchange", () => {
    const messages = [
      said("user", "old"),
      toolCall("t1"),
      toolResult("t1"),
      said("assistant", "answer"),
      said("user", "newer"),
      said("assistant", "reply"),
    ];
    const out = trimTranscript(messages, 3);
    // A naive slice(-3) would start at the tool_result and orphan its call.
    expect(out[0]).toEqual(said("user", "newer"));
    expect(out).toHaveLength(2);
  });

  it("keeps every tool_use paired with its tool_result", () => {
    const messages = [
      said("user", "one"),
      said("assistant", "ok"),
      said("user", "two"),
      toolCall("t9"),
      toolResult("t9"),
      said("assistant", "done"),
    ];
    const out = trimTranscript(messages, 4);
    const calls = out.flatMap((m) =>
      Array.isArray(m.content)
        ? m.content.filter((b) => (b as { type?: string }).type === "tool_use")
        : [],
    );
    const results = out.flatMap((m) =>
      Array.isArray(m.content)
        ? m.content.filter((b) => (b as { type?: string }).type === "tool_result")
        : [],
    );
    expect(calls).toHaveLength(results.length);
  });

  it("keeps an over-long transcript rather than saving a broken one", () => {
    // No clean boundary in the tail. An invalid transcript is a dead feature;
    // a long one is only a cost, and the next turn gets another chance to trim.
    const messages = [
      said("user", "start"),
      toolCall("t1"),
      toolResult("t1"),
      toolCall("t2"),
      toolResult("t2"),
    ];
    expect(trimTranscript(messages, 2)).toBe(messages);
  });
});

describe("rendering a stored conversation back onto the page", () => {
  it("keeps what was said and drops the machinery", () => {
    const turns = transcriptToTurns([
      said("user", "what should I train"),
      toolCall("t1"),
      toolResult("t1"),
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me look" },
          { type: "text", text: "Legs." },
        ],
      },
    ]);
    expect(turns).toEqual([
      { kind: "user", text: "what should I train" },
      { kind: "bot", text: "Legs." },
    ]);
  });

  it("skips a turn with no text of its own", () => {
    // An assistant turn that was pure tool calls has nothing to show.
    expect(transcriptToTurns([toolCall("t1")])).toEqual([]);
  });

  it("joins several text blocks in one turn", () => {
    const turns = transcriptToTurns([
      {
        role: "assistant",
        content: [
          { type: "text", text: "First. " },
          { type: "text", text: "Second." },
        ],
      },
    ]);
    expect(turns[0].text).toBe("First. Second.");
  });

  it("ignores a role it does not render", () => {
    expect(transcriptToTurns([said("system", "nope")])).toEqual([]);
  });
});
