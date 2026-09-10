"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, Check, Loader2, Sparkles, X } from "lucide-react";
import { DesktopTopBar } from "@/components/DesktopTopBar";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { toast } from "@/hooks/use-toast";
import { queryClient, describeApiError } from "@/lib/queryClient";
import { clientTimeZone } from "@/lib/date";
import { buildProposalRequest } from "@/lib/ai/fitbot-tools";

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

const OPENERS = [
  "What should I train today?",
  "Look at how I've been doing my routine and tell me what you see",
  "Which muscle groups am I behind on?",
  "Make my routine 4 days a week instead of 5",
];

/** An opaque Anthropic message, stored exactly as the route returned it. */
type Transcript = { role: "user" | "assistant"; content: unknown }[];

type Proposal = {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  /** Resolved locally rather than trusted from the stream. See below. */
  status: "pending" | "approved" | "rejected" | "failed";
};

type Turn =
  | { kind: "user"; text: string }
  | { kind: "bot"; text: string }
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

export default function FitBotChatPage() {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [transcript, setTranscript] = useState<Transcript>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    setInput("");
    setTurns((t) => [...t, { kind: "user", text: message }]);
    setBusy(true);

    try {
      const res = await fetch(`/api/ai/chat?tz=${encodeURIComponent(clientTimeZone())}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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
          } else if (event.type === "tool") {
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
            setTurns((t) => [
              ...t,
              {
                kind: "proposal",
                proposal: {
                  tool: String(event.tool ?? ""),
                  input: (event.input ?? {}) as Record<string, unknown>,
                  summary: String(event.summary ?? "Proposed change"),
                  status: "pending",
                },
              },
            ]);
          } else if (event.type === "done") {
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
    } catch (e) {
      toast({
        title: "Couldn't reach FitBot",
        description: describeApiError(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Apply an approved proposal against the app's own endpoint.
   *
   * The request is rebuilt HERE from the tool input rather than taken off the
   * stream, so a malformed or unexpected event can never be turned into an
   * arbitrary call: only the eight known proposals resolve to a request at all.
   */
  async function approve(index: number, proposal: Proposal) {
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
      void send(`I approved that: ${proposal.summary}. It has been applied.`);
    } catch (e) {
      setStatus("failed");
      toast({ title: "Couldn't apply that", description: describeApiError(e), variant: "destructive" });
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
    void send(`No, don't do that: ${proposal.summary}`);
  }

  const empty = turns.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <DesktopTopBar title="FitBot" eyebrow="Coach" />

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
            if (turn.kind === "tools") {
              return (
                <div key={i} className="space-y-1" data-testid="chat-tools">
                  {turn.names.map((n, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-tertiary-foreground"
                    >
                      <Check className="h-3 w-3 text-primary" />
                      {TOOL_LABELS[n] ?? n}
                    </div>
                  ))}
                </div>
              );
            }
            if (turn.kind === "proposal") {
              const p = turn.proposal;
              return (
                <div
                  key={i}
                  className="rounded-[16px] border-yellow bg-primary-dim p-4"
                  data-testid="chat-proposal"
                >
                  <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
                    Proposed change
                  </div>
                  <p className="mt-2 text-[15px] text-foreground">{p.summary}</p>
                  <ProposalDetail tool={p.tool} input={p.input} />

                  {p.status === "pending" ? (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => approve(i, p)}
                        data-testid="button-approve-proposal"
                        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-sm font-bold text-primary-foreground shadow-cta"
                      >
                        <Check className="h-4 w-4" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => reject(i, p)}
                        data-testid="button-reject-proposal"
                        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border-strong bg-white/[0.03] text-sm font-semibold text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                        No
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-tertiary-foreground">
                      {p.status === "approved"
                        ? "Applied"
                        : p.status === "rejected"
                          ? "Declined"
                          : "Could not apply"}
                    </div>
                  )}
                  {p.status === "pending" && (
                    <p className="mt-2 text-[12px] leading-snug text-tertiary-foreground">
                      Or just tell it what to change instead.
                    </p>
                  )}
                </div>
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
          <div ref={bottomRef} />
        </div>

        {/* The mobile BottomNav is a 20-unit fixed bar over the viewport, and
            this composer sticks to the scrollport bottom - which is UNDER it.
            Offset on mobile only; at md+ there is no bottom bar. */}
        <div className="sticky bottom-20 flex items-end gap-2 bg-background pb-2 pt-2 md:bottom-0">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask FitBot…"
            data-testid="input-chat"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[14px] border-strong bg-white/[0.03] px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-tertiary-foreground"
          />
          <VoiceInputButton value={input} onChange={setInput} disabled={busy} tone="ghost" />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={!input.trim() || busy}
            aria-label="Send"
            data-testid="button-send-chat"
            className={CTA_SEND}
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The concrete shape of a proposal, so "approve" is an informed decision. */
function ProposalDetail({
  tool,
  input,
}: {
  tool: string;
  input: Record<string, unknown>;
}) {
  if (tool === "propose_routine_change" && Array.isArray(input.days)) {
    return (
      <div className="mt-3 space-y-2">
        {(input.days as Record<string, unknown>[]).map((d, i) => (
          <div key={i} className="rounded-xl border-strong bg-white/[0.03] p-2.5">
            <div className="text-[13px] font-semibold text-foreground">
              Day {String(d.dayIndex)} · {String(d.workoutName ?? "")}
            </div>
            <ul className="mt-1 space-y-0.5">
              {(Array.isArray(d.exercises) ? d.exercises : []).map(
                (e: Record<string, unknown>, j: number) => (
                  <li key={j} className="font-mono text-[12px] tabular-nums text-muted-foreground">
                    {String(e.name)} · {String(e.sets ?? "")} x {String(e.reps ?? "")}
                  </li>
                ),
              )}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  const skip = new Set(["summary", "routineId", "scheduledWorkoutId"]);
  const fields = Object.entries(input).filter(
    ([k, v]) => !skip.has(k) && v !== undefined && v !== null,
  );
  if (fields.length === 0) return null;

  return (
    <ul className="mt-3 space-y-0.5">
      {fields.map(([k, v]) => (
        <li key={k} className="font-mono text-[12px] text-muted-foreground">
          {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
        </li>
      ))}
    </ul>
  );
}
