"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp, Check, Loader2, Sparkles, Square } from "lucide-react";
import { DesktopTopBar } from "@/components/DesktopTopBar";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { toast } from "@/hooks/use-toast";
import { queryClient, describeApiError } from "@/lib/queryClient";
import { clientTimeZone } from "@/lib/date";
import { buildProposalRequest } from "@/lib/ai/fitbot-tools";
import { ProposalCard, type ChatProposal } from "@/components/fitbot/ProposalCard";
import { hasPendingRoutineChange, supersedeKey } from "@/lib/fitbot-proposals";

/**
 * Talking to FitBot, with the whole app in reach.
 *
 * Until this page the only ways to use FitBot were two one-shot forms: describe
 * a workout, or build a program. Neither could look at what you had actually
 * done, and neither let you answer back. Ivo, 2026-09-10: "what if I just want
 * to have a conversation with fitbot about what I want done."
 *
 * A change FitBot wants to make arrives as a PROPOSAL card, never as a
 * completed action. Approving it fires the app's own endpoint with the user's
 * session, so it takes the same path as doing it by hand. Rejecting says so and
 * lets the conversation continue, and typing a correction instead of pressing
 * either button is the third option Ivo asked for: "I approve/deny/change what
 * it is going to do."
 */

const CTA_SEND =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-primary-foreground shadow-cta disabled:opacity-40";

const CTA_STOP =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-strong bg-white/[0.06] text-foreground";

const OPENERS = [
  "What should I train today?",
  "Look at how I've been doing my routine and tell me what you see",
  "Which muscle groups am I behind on?",
  "Make my routine 4 days a week instead of 5",
];

/** An opaque Anthropic message, stored exactly as the route returned it. */
type Transcript = { role: "user" | "assistant"; content: unknown }[];

type Proposal = ChatProposal;

type Turn =
  | { kind: "user"; text: string }
  | { kind: "bot"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tools"; names: string[] }
  | { kind: "proposal"; proposal: Proposal };

const TOOL_LABELS: Record<string, string> = {
  get_training_summary: "Reading your training history",
  get_active_program: "Checking your program and how you've followed it",
  list_routines: "Looking at your routines",
  get_routine: "Reading a routine",
  list_recent_workouts: "Reading recent workouts",
  search_exercises: "Searching the exercise library",
  list_upcoming_workouts: "Checking your calendar",
  get_body_measurements: "Reading your measurements",
  get_personal_records: "Reading your records",
  get_settings: "Checking your settings",
};

/**
 * Memory writes get their own labels, and their own phrasing.
 *
 * These are the one thing FitBot does without asking, so the person watching
 * should always see it happen. "Remembering that" while it writes is the
 * visible half of that bargain; the other half is the Settings screen, where
 * everything it holds can be read and deleted.
 */
const MEMORY_LABELS: Record<string, string> = {
  remember: "Remembering that",
  update_memory: "Updating what it knows about you",
  forget: "Forgetting that",
};

export default function FitBotChatPage() {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [transcript, setTranscript] = useState<Transcript>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Until the stored conversation has been fetched, an empty page would flash
  // the opener prompts at somebody who has been talking to FitBot for weeks.
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // Lets Stop abort the in-flight turn. Held in a ref because the click handler
  // must reach the CURRENT request, not the one captured when it rendered.
  const abortRef = useRef<AbortController | null>(null);
  // "I approved that" for an approval tapped while FitBot was still answering.
  // `send` refuses while busy, so this used to be dropped on the floor: the
  // change applied and FitBot was never told, then built on stale state.
  const queuedRef = useRef<string | null>(null);
  const [applying, setApplying] = useState<number | null>(null);
  // The composer is pinned over the page, so the thread needs room under its
  // last line equal to the composer's height, which grows with what is typed.
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(96);

  const { data: settings } = useQuery<{ weightUnit?: string }>({ queryKey: ["/api/user-settings"] });
  const weightUnit = settings?.weightUnit === "kg" ? "kg" : "lbs";

  /**
   * Grow the composer with its content, from two lines up to a ceiling.
   * Dictation is the case that needs it: a long transcript lands all at once
   * and a fixed-height box hides everything but the last line.
   */
  const autoGrow = () => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  useEffect(autoGrow, [input]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setComposerHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `block: "end"` against a spacer as tall as the composer: the last line
  // lands just above the composer instead of underneath it.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, composerHeight]);

  /**
   * Pick the conversation back up.
   *
   * The server holds the model's copy of the transcript and hands back only
   * what was SAID, so this restores the thread without replaying tool activity
   * or stale proposal cards. A failure here is deliberately quiet: not being
   * able to show last week's conversation is no reason to stop somebody having
   * this one, and the server still has it either way.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/coach-conversation", { credentials: "include" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { turns?: { kind: "user" | "bot"; text: string }[] };
        if (!cancelled && data.turns?.length) setTurns(data.turns);
      } catch {
        // Nothing to say to the user; they simply start from a clean page.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Start a fresh thread.
   *
   * This clears the CONVERSATION and never the memory. Wanting a clean page is
   * not the same as wanting the coach to forget your injury, and a button that
   * quietly did both would be the worst kind of destructive. What FitBot knows
   * is managed on its own screen in Settings.
   */
  async function startNew() {
    if (busy) return;
    try {
      await fetch("/api/coach-conversation", { method: "DELETE", credentials: "include" });
      setTurns([]);
      setTranscript([]);
      toast({
        title: "Started a new conversation",
        description: "FitBot still remembers what it knows about you.",
      });
    } catch (e) {
      toast({ title: "Couldn't clear that", description: describeApiError(e), variant: "destructive" });
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    setInput("");
    setTurns((t) => [...t, { kind: "user", text: message }]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;
    // A turn that ends without its "done" event did not finish: the platform
    // killed the function, the network dropped, or the user pressed Stop. That
    // used to leave the last sentence sitting there looking complete.
    let finished = false;

    try {
      const res = await fetch(`/api/ai/chat?tz=${encodeURIComponent(clientTimeZone())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({ message, history: transcript }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`${res.status}: ${await res.text()}`);
      }

      // NDJSON: one event per line. A chunk can split a line anywhere, so the
      // tail is carried over rather than parsed.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamingText = "";

      const pushText = (chunk: string) => {
        streamingText += chunk;
        setTurns((t) => {
          const last = t[t.length - 1];
          if (last?.kind === "bot") {
            return [...t.slice(0, -1), { kind: "bot", text: streamingText }];
          }
          return [...t, { kind: "bot", text: streamingText }];
        });
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "text") {
            pushText(String(event.text ?? ""));
          } else if (event.type === "tool" || event.type === "memory") {
            streamingText = "";
            const name = String(event.name ?? "");
            setTurns((t) => {
              const last = t[t.length - 1];
              if (last?.kind === "tools") {
                return [...t.slice(0, -1), { kind: "tools", names: [...last.names, name] }];
              }
              return [...t, { kind: "tools", names: [name] }];
            });
          } else if (event.type === "proposal") {
            streamingText = "";
            const incoming: Proposal = {
              tool: String(event.tool ?? ""),
              input: (event.input ?? {}) as Record<string, unknown>,
              summary: String(event.summary ?? "Proposed change"),
              status: "pending",
            };
            // A newer version of the same change retires the older card, so a
            // stale routine or start date can no longer be approved by a tap on
            // something scrolled up the thread.
            const key = supersedeKey(incoming.tool, incoming.input);
            setTurns((t) => [
              ...t.map((turn): Turn =>
                key &&
                turn.kind === "proposal" &&
                turn.proposal.status === "pending" &&
                supersedeKey(turn.proposal.tool, turn.proposal.input) === key
                  ? { kind: "proposal", proposal: { ...turn.proposal, status: "superseded" } }
                  : turn,
              ),
              { kind: "proposal", proposal: incoming },
            ]);
          } else if (event.type === "thinking") {
            streamingText = "";
            const text = String(event.text ?? "");
            setTurns((t) => {
              const last = t[t.length - 1];
              if (last?.kind === "thinking") {
                return [...t.slice(0, -1), { kind: "thinking", text: last.text + text }];
              }
              return [...t, { kind: "thinking", text }];
            });
          } else if (event.type === "done") {
            finished = true;
            setTranscript((event.history ?? []) as Transcript);
          } else if (event.type === "error") {
            toast({
              title: "FitBot",
              description: String(event.message ?? "Something went wrong."),
              variant: "destructive",
            });
          }
        }
      }
      if (!finished) {
        // Say so in the transcript, not just a toast: the half-written answer
        // stays on screen and has to be labelled, or it reads as the whole
        // reply. Being stopped by the user is not a failure worth shouting about.
        setTurns((t) => [
          ...t,
          {
            kind: "bot",
            text: controller.signal.aborted
              ? "(stopped)"
              : "(That answer was cut off before it finished. Ask me to continue and I will pick up where I left off.)",
          },
        ]);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        toast({
          title: "Couldn't reach FitBot",
          description: describeApiError(e),
          variant: "destructive",
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      const queued = queuedRef.current;
      queuedRef.current = null;
      // This closure saw busy === false when it started, so the guard passes.
      if (queued) void send(queued);
    }
  }

  /** Say something to FitBot now, or as soon as the current answer finishes. */
  function tellFitBot(text: string) {
    if (busy) queuedRef.current = text;
    else void send(text);
  }

  function stop() {
    abortRef.current?.abort();
  }

  /**
   * Apply an approved proposal against the app's own endpoint.
   *
   * The request is rebuilt HERE from the tool input rather than taken off the
   * stream, so a malformed or unexpected event can never be turned into an
   * arbitrary call: only the eight known proposals resolve to a request at all.
   */
  async function approve(index: number, proposal: Proposal) {
    // One application per card: a second tap while the first is in flight would
    // start the same program twice (the second is refused, as a failure).
    if (applying !== null) return;
    const request = buildProposalRequest(proposal.tool, proposal.input);
    if (!request) {
      toast({ title: "FitBot proposed something I can't apply", variant: "destructive" });
      return;
    }

    const setStatus = (status: Proposal["status"]) =>
      setTurns((t) =>
        t.map((turn, i) =>
          i === index && turn.kind === "proposal"
            ? { kind: "proposal", proposal: { ...turn.proposal, status } }
            : turn,
        ),
      );

    setApplying(index);
    try {
      const res = await fetch(request.path, {
        method: request.method,
        headers: request.body ? { "Content-Type": "application/json" } : undefined,
        credentials: "include",
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

      setStatus("approved");
      // Everything the proposals touch is read through react-query somewhere.
      queryClient.invalidateQueries();
      toast({ title: "Done", description: proposal.summary });

      // Tell FitBot it landed, so the conversation stays honest about state and
      // it can offer the follow-up (a routine change wants a resync next).
      tellFitBot(`I approved that: ${proposal.summary}. It has been applied.`);
    } catch (e) {
      setStatus("failed");
      toast({ title: "Couldn't apply that", description: describeApiError(e), variant: "destructive" });
    } finally {
      setApplying(null);
    }
  }

  function reject(index: number, proposal: Proposal) {
    setTurns((t) =>
      t.map((turn, i) =>
        i === index && turn.kind === "proposal"
          ? { kind: "proposal", proposal: { ...turn.proposal, status: "rejected" } }
          : turn,
      ),
    );
    tellFitBot(`No, don't do that: ${proposal.summary}`);
  }

  // Not "no turns" but "nothing to show and nothing coming": the openers must
  // not flash up for a moment in front of a conversation that is about to load.
  const empty = turns.length === 0 && !loading;

  return (
    <div className="flex flex-1 flex-col">
      <DesktopTopBar title="FitBot" eyebrow="Coach">
        {turns.length > 0 && (
          <button
            type="button"
            onClick={startNew}
            data-testid="button-new-conversation-desktop"
            className="rounded-full border-strong bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
          >
            New chat
          </button>
        )}
      </DesktopTopBar>

      <header className="flex h-14 items-center gap-3 px-4 md:hidden">
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full border-strong bg-white/[0.03]"
        >
          <ArrowLeft className="h-[18px] w-[18px] text-muted-foreground" />
        </button>
        <span className="text-base font-bold text-foreground">FitBot</span>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={startNew}
            data-testid="button-new-conversation"
            className="ml-auto font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary-foreground"
          >
            New chat
          </button>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-4 md:px-9">
        <div className="flex-1 space-y-4 py-4">
          {empty && (
            <div className="flex flex-col items-center px-2 py-10 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-dim">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <p className="max-w-sm text-[15px] text-muted-foreground">
                Ask about your training. FitBot can read your workouts, routines and
                measurements, and can change things once you approve.
              </p>
              <div className="mt-6 w-full space-y-2">
                {OPENERS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => send(o)}
                    data-testid="button-chat-opener"
                    className="w-full rounded-[14px] border-strong bg-white/[0.03] px-4 py-3 text-left text-[14px] text-muted-foreground hover:text-foreground"
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((turn, i) => {
            if (turn.kind === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[16px] rounded-br-[4px] bg-primary-dim px-4 py-2.5 text-[15px] text-foreground">
                    {turn.text}
                  </div>
                </div>
              );
            }
            if (turn.kind === "thinking") {
              return (
                <p
                  key={i}
                  className="whitespace-pre-wrap text-[13px] leading-relaxed text-tertiary-foreground"
                  data-testid="chat-thinking"
                >
                  {turn.text}
                </p>
              );
            }
            if (turn.kind === "tools") {
              return (
                <div key={i} className="space-y-1" data-testid="chat-tools">
                  {turn.names.map((n, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-tertiary-foreground"
                    >
                      <Check className="h-3 w-3 text-primary" />
                      {TOOL_LABELS[n] ?? MEMORY_LABELS[n] ?? n}
                    </div>
                  ))}
                </div>
              );
            }
            if (turn.kind === "proposal") {
              const p = turn.proposal;
              return (
                <ProposalCard
                  key={i}
                  proposal={p}
                  weightUnit={weightUnit}
                  routineChangeWaiting={
                    p.tool === "propose_start_routine" &&
                    hasPendingRoutineChange(
                      turns.flatMap((x) => (x.kind === "proposal" ? [x.proposal] : [])),
                      p.input.routineId,
                    )
                  }
                  applying={applying === i}
                  onApprove={() => approve(i, p)}
                  onReject={() => reject(i, p)}
                />
              );
            }
            return (
              <div key={i} className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
                {turn.text}
              </div>
            );
          })}

          {busy && (
            <div className="flex items-center gap-2 text-[13px] text-tertiary-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking
            </div>
          )}
          {/* Room for the pinned composer, so the last line can scroll clear
              of it. The scroll target, too: see the effect above. Its scroll
              margin is the mobile BottomNav, so "end" means above the nav and
              not behind it. */}
          <div
            ref={bottomRef}
            aria-hidden
            style={{ height: composerHeight }}
            className="scroll-mb-[calc(5rem+env(safe-area-inset-bottom))] md:scroll-mb-0"
            data-testid="chat-composer-spacer"
          />
        </div>
      </div>

      {/* PINNED to the viewport, above the mobile BottomNav (h-20 plus the
          safe area) and beside the desktop rail. It was `sticky bottom-20`
          until 2026-10-03, which never stuck: <main> is overflow-auto, so the
          composer stuck to main's padding box instead, and with main's own
          pb-20 that put it 64px up over the end of the conversation. Ivo:
          "sometimes I can't see the end of his response as it's behind the
          chat box." */}
      <div
        ref={composerRef}
        className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 bg-background md:bottom-0 md:left-20 lg:left-24"
        data-testid="chat-composer"
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 pb-2 pt-2 md:px-9 md:pb-4">
          <textarea
            ref={boxRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder="Ask FitBot…"
            data-testid="input-chat"
            className="max-h-[220px] flex-1 resize-none overflow-y-auto rounded-[14px] border-strong bg-white/[0.03] px-4 py-3 text-[15px] leading-[1.45] text-foreground outline-none placeholder:text-tertiary-foreground"
          />
          {/* Dictation stays enabled while FitBot is answering, so the next
              question can be composed without waiting for this one. */}
          <VoiceInputButton value={input} onChange={setInput} tone="ghost" />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop"
              data-testid="button-stop-chat"
              className={CTA_STOP}
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={!input.trim()}
              aria-label="Send"
              data-testid="button-send-chat"
              className={CTA_SEND}
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
