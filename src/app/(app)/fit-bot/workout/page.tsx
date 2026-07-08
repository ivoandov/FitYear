"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  ArrowLeft,
  Sparkles,
  Pencil,
  Check,
  ArrowUp,
  Play,
  Loader2,
  List,
} from "lucide-react";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { useWorkout } from "@/context/WorkoutContext";
import {
  planReconciliation,
  distinctCreates,
} from "@/lib/workout-reconcile";
import { normalizeExerciseName } from "@/lib/exercise-match";
import type {
  GeneratedWorkout,
  GeneratedExercise,
  WorkoutChange,
} from "@/lib/workout-schema";

// The neon primary CTA of the refresh: the brand gradient + strong glow, tall
// touch target. This exact gradient is the design's one primary-CTA treatment.
const CTA =
  "h-14 w-full rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-primary-foreground font-bold text-base shadow-cta-strong disabled:opacity-60 flex items-center justify-center gap-2";

type Phase = "prompt" | "generating" | "review" | "error";

interface ChatTurn {
  role: "bot" | "user";
  text: string;
}

interface QuickOptions {
  durationMinutes?: number;
  location?: string;
  intensity?: string;
}

const DURATIONS = [30, 45, 60, 90];
const EXAMPLE_PROMPTS = [
  "A 45-minute high-intensity lifting workout at the gym that kills my arms",
  "Quick 20-minute core finisher, no equipment",
];
const REFINE_CHIPS = ["Make it harder", "Swap a move", "Add a finisher"];

export default function FitBotWorkoutPage() {
  const router = useRouter();
  const { startGeneratedWorkout } = useWorkout();

  const [phase, setPhase] = useState<Phase>("prompt");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState<QuickOptions>({});
  const [workout, setWorkout] = useState<GeneratedWorkout | null>(null);
  const [name, setName] = useState("");
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [lastChanges, setLastChanges] = useState<WorkoutChange[]>([]);
  const [refining, setRefining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  // Stable-per-mount stamp for fallback exercise ids (no Date.now churn per row).
  const startedStamp = useRef(Date.now());

  // Full exercise catalog — used to flag exercises that are NEW to the user's
  // library (a preview-time reconcile) and reused on Start.
  const { data: catalog = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/exercises"],
  });

  // Preview-time reconcile: which generated exercises don't yet exist in the
  // library. `create` => NEW badge.
  const newFlags = useMemo(() => {
    if (!workout) return [] as boolean[];
    const plan = planReconciliation(
      workout.exercises,
      catalog.map((c) => ({ id: c.id, name: c.name })),
    );
    return plan.map((p) => p.action === "create");
  }, [workout, catalog]);

  const hasUserMessage = transcript.some((t) => t.role === "user");
  const view: "list" | "chat" = hasUserMessage ? "chat" : "list";

  function close() {
    router.back();
  }

  async function handleGenerate() {
    const p = prompt.trim();
    if (!p) return;
    setError(null);
    setPhase("generating");
    try {
      const res = await apiRequest("POST", "/api/ai/generate-workout", {
        prompt: p,
        options: Object.keys(options).length ? options : undefined,
      });
      const w = (await res.json()) as GeneratedWorkout;
      setWorkout(w);
      setName(w.name);
      setTranscript([
        {
          role: "bot",
          text: `Here's your ${w.estimatedMinutes ? `${w.estimatedMinutes}-minute ` : ""}workout. Tell me anything you'd like to change.`,
        },
      ]);
      setLastChanges([]);
      setPhase("review");
    } catch (e) {
      setError(describeApiError(e));
      setPhase("error");
    }
  }

  async function handleRefine(instruction: string) {
    const text = instruction.trim();
    if (!text || !workout || refining) return;
    setMessage("");
    setTranscript((t) => [...t, { role: "user", text }]);
    setRefining(true);
    try {
      const res = await apiRequest("POST", "/api/ai/refine-workout", {
        workout,
        instruction: text,
        originalPrompt: prompt,
      });
      const data = (await res.json()) as {
        workout: GeneratedWorkout;
        changes: WorkoutChange[];
        summary: string;
      };
      setWorkout(data.workout);
      setName(data.workout.name);
      setLastChanges(data.changes ?? []);
      setTranscript((t) => [
        ...t,
        { role: "bot", text: data.summary || "Done — updated your workout." },
      ]);
    } catch (e) {
      // Keep the prior workout; surface the failure inline.
      setTranscript((t) => [
        ...t,
        { role: "bot", text: `I couldn't apply that — ${describeApiError(e)}` },
      ]);
    } finally {
      setRefining(false);
    }
  }

  async function handleStart() {
    if (!workout || starting) return;
    setStarting(true);
    try {
      const cat = catalog.map((c) => ({ id: c.id, name: c.name }));
      const plan = planReconciliation(workout.exercises, cat);
      const creates = distinctCreates(plan);

      // Create each genuinely-new exercise as a custom (shared) library entry,
      // then kick off its AI illustration best-effort (non-blocking).
      const createdByKey = new Map<string, string>();
      for (const ex of creates) {
        try {
          const res = await apiRequest("POST", "/api/exercises", {
            name: ex.name,
            muscleGroups: ex.muscleGroups ?? [],
            description: ex.notes?.trim() || "",
            exerciseType: ex.exerciseType ?? "weight_reps",
            isAssisted: ex.isAssisted ?? false,
          });
          const created = (await res.json()) as { id: string };
          createdByKey.set(normalizeExerciseName(ex.name), created.id);
          apiRequest("POST", `/api/exercises/${created.id}/regenerate-image`, {}).catch(
            () => {},
          );
        } catch {
          // Creation failed (e.g. transient): fall through to a client-side id
          // so the workout can still start; it just won't link to the library.
        }
      }

      const resolved = plan.map((item, i) => {
        const src = item.source;
        const id =
          item.action === "reuse"
            ? item.exerciseId!
            : createdByKey.get(item.createKey ?? normalizeExerciseName(src.name)) ??
              `fitbot-ex-${i}-${startedStamp.current}`;
        return {
          id,
          name: src.name,
          muscleGroups: src.muscleGroups ?? [],
          description: src.notes?.trim() || "",
          exerciseType: src.exerciseType ?? "weight_reps",
          isAssisted: src.isAssisted ?? false,
          sets: src.sets,
          reps: src.reps,
          rest: src.rest,
        };
      });

      // Newly-created customs must appear in the catalog so Track can enrich
      // them (name/image/metadata) on arrival.
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      startGeneratedWorkout({ name: name.trim() || workout.name, exercises: resolved });
      // Client-side nav preserves the just-set active workout in context (a full
      // reload would race the debounced persist). Track reads it from context.
      router.push("/track");
    } catch (e) {
      toast({
        title: "Couldn't start the workout",
        description: describeApiError(e),
        variant: "destructive",
      });
      setStarting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
      {phase === "prompt" && (
        <PromptScreen
          prompt={prompt}
          setPrompt={setPrompt}
          options={options}
          setOptions={setOptions}
          onClose={close}
          onGenerate={handleGenerate}
        />
      )}

      {phase === "generating" && (
        <GeneratingScreen prompt={prompt} options={options} onCancel={() => setPhase("prompt")} />
      )}

      {phase === "error" && (
        <ErrorScreen
          message={error}
          onRetry={() => setPhase("prompt")}
          onClose={close}
        />
      )}

      {phase === "review" && workout && (
        <ReviewScreen
          workout={workout}
          name={name}
          setName={setName}
          view={view}
          transcript={transcript}
          lastChanges={lastChanges}
          newFlags={newFlags}
          refining={refining}
          starting={starting}
          message={message}
          setMessage={setMessage}
          onClose={close}
          onRefine={handleRefine}
          onStart={handleStart}
        />
      )}
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function TopBar({
  onClose,
  label,
  backIcon,
  right,
}: {
  onClose: () => void;
  label: string;
  backIcon?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex h-9 w-9 items-center justify-center rounded-xl border bg-white/[0.03] text-muted-foreground hover:text-foreground"
      >
        {backIcon ? <ArrowLeft className="h-[18px] w-[18px]" /> : <X className="h-[18px] w-[18px]" />}
      </button>
      <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        {right ?? label}
      </div>
    </div>
  );
}

function subline(ex: GeneratedExercise): string {
  const muscles = (ex.muscleGroups ?? []).map((m) => m.toUpperCase());
  const parts = [...muscles];
  if (ex.rest) parts.push(`${ex.rest}s REST`);
  return parts.join(" · ");
}

function repsLabel(ex: GeneratedExercise): string {
  return `${ex.sets} × ${ex.reps}`;
}

function NewBadge() {
  return (
    <span className="rounded bg-primary text-primary-foreground px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em]">
      New
    </span>
  );
}

/* --------------------------- Prompt (3a) -------------------------------- */

function PromptScreen({
  prompt,
  setPrompt,
  options,
  setOptions,
  onClose,
  onGenerate,
}: {
  prompt: string;
  setPrompt: (v: string) => void;
  options: QuickOptions;
  setOptions: (v: QuickOptions) => void;
  onClose: () => void;
  onGenerate: () => void;
}) {
  const seg = (active: boolean) =>
    `flex-1 rounded-[10px] py-2.5 text-center text-[13px] transition-colors ${
      active
        ? "border-[1.5px] border-yellow bg-primary-dim font-bold text-primary"
        : "border bg-white/[0.03] text-muted-foreground"
    }`;

  return (
    <>
      <TopBar onClose={onClose} label="FitBot" />
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="mt-2 space-y-5">
          <div>
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">
              What kind of workout would you like today?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Describe your ideal session — FitBot builds it in seconds.
            </p>
          </div>

          {/* Prompt field */}
          <div className="rounded-2xl border-[1.5px] border-yellow bg-[#121210] p-4 shadow-[0_0_0_3px_rgba(229,255,0,0.08)]">
            <textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="A killer bodyweight workout at home for the next hour that hits my hamstrings, glutes and abs"
              maxLength={2000}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
              data-testid="input-fitbot-prompt"
            />
            <div className="flex items-center justify-between pt-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-tertiary-foreground">
                Type or speak
              </span>
              {/* Mic lands with the voice-input change. */}
            </div>
          </div>

          {/* Quick options */}
          <div className="space-y-3.5">
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-tertiary-foreground">
                Duration
              </div>
              <div className="flex gap-2">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setOptions({
                        ...options,
                        durationMinutes: options.durationMinutes === d ? undefined : d,
                      })
                    }
                    className={`${seg(options.durationMinutes === d)} font-mono`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3.5">
              <div className="flex-1">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-tertiary-foreground">
                  Where
                </div>
                <div className="flex gap-2">
                  {["Home", "Gym"].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() =>
                        setOptions({
                          ...options,
                          location: options.location === w ? undefined : w,
                        })
                      }
                      className={seg(options.location === w)}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-tertiary-foreground">
                  Intensity
                </div>
                <div className="flex gap-2">
                  {[
                    ["Mod", "Moderate"],
                    ["High", "High"],
                  ].map(([short, full]) => (
                    <button
                      key={short}
                      type="button"
                      onClick={() =>
                        setOptions({
                          ...options,
                          intensity: options.intensity === full ? undefined : full,
                        })
                      }
                      className={seg(options.intensity === full)}
                    >
                      {short}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Example prompts */}
          <div>
            <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-tertiary-foreground">
              Try
            </div>
            <div className="flex flex-col gap-2">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="rounded-xl border bg-[#141412] px-3.5 py-3 text-left text-[13px] leading-snug text-muted-foreground hover:text-foreground"
                >
                  &ldquo;{ex}&rdquo;
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky build CTA */}
      <div className="bg-gradient-to-t from-background via-background to-transparent px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
        <button
          type="button"
          disabled={!prompt.trim()}
          onClick={onGenerate}
          className={CTA}
          data-testid="button-fitbot-build"
        >
          <Sparkles className="h-[19px] w-[19px]" />
          Build my workout
        </button>
      </div>
    </>
  );
}

/* --------------------------- Generating (3b) ---------------------------- */

function GeneratingScreen({
  prompt,
  options,
  onCancel,
}: {
  prompt: string;
  options: QuickOptions;
  onCancel: () => void;
}) {
  const chips = useMemo(() => {
    const out: string[] = [];
    if (options.durationMinutes) out.push(`${options.durationMinutes} MIN`);
    if (options.location) out.push(options.location.toUpperCase());
    if (options.intensity) out.push(options.intensity.toUpperCase());
    // A couple of keyword hints pulled from the prompt so the screen feels alive.
    const words = prompt
      .toLowerCase()
      .match(/hamstrings|glutes|abs|arms|chest|back|legs|shoulders|core|cardio|bodyweight/g);
    for (const w of words ?? []) {
      const u = w.toUpperCase();
      if (!out.includes(u)) out.push(u);
    }
    return out.slice(0, 5);
  }, [prompt, options]);

  return (
    <div className="flex flex-1 flex-col px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-11">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-[88px] w-[88px] items-center justify-center rounded-full bg-[radial-gradient(circle,rgba(229,255,0,0.18),rgba(229,255,0,0)_70%)]">
          <div className="flex h-[60px] w-[60px] animate-pulse items-center justify-center rounded-full border-[1.5px] border-yellow bg-primary-dim text-primary">
            <Sparkles className="h-7 w-7" />
          </div>
        </div>
        <h2 className="mb-2 text-[22px] font-bold">Building your workout…</h2>
        <p className="mb-6 max-w-[260px] text-sm leading-relaxed text-muted-foreground">
          Matching exercises to your goals and time.
        </p>
        {chips.length > 0 && (
          <div className="mb-7 flex max-w-[280px] flex-wrap justify-center gap-1.5">
            {chips.map((c) => (
              <span
                key={c}
                className="rounded-full border border-yellow bg-primary-dim px-2.5 py-1 font-mono text-[11px] text-primary"
              >
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="flex w-full flex-col gap-2.5">
          {[1, 0.7, 0.4].map((o, i) => (
            <div
              key={i}
              style={{ opacity: o }}
              className="h-[52px] animate-pulse rounded-xl border bg-[linear-gradient(90deg,#161614,#1c1c19,#161614)]"
            />
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="h-12 w-full rounded-2xl border-strong bg-transparent font-semibold text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

/* ----------------------------- Error state ------------------------------ */

function ErrorScreen({
  message,
  onRetry,
  onClose,
}: {
  message: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <TopBar onClose={onClose} label="FitBot" />
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <h2 className="mb-2 text-[22px] font-bold">FitBot hit a snag</h2>
        <p className="mb-7 max-w-[300px] text-sm leading-relaxed text-muted-foreground">
          {message ?? "Something went wrong generating your workout."}
        </p>
        <button type="button" onClick={onRetry} className={`${CTA} max-w-[280px]`}>
          Try again
        </button>
      </div>
    </>
  );
}

/* ------------------------- Review + Refine (3c/3d) ---------------------- */

function ReviewScreen({
  workout,
  name,
  setName,
  view,
  transcript,
  lastChanges,
  newFlags,
  refining,
  starting,
  message,
  setMessage,
  onClose,
  onRefine,
  onStart,
}: {
  workout: GeneratedWorkout;
  name: string;
  setName: (v: string) => void;
  view: "list" | "chat";
  transcript: ChatTurn[];
  lastChanges: WorkoutChange[];
  newFlags: boolean[];
  refining: boolean;
  starting: boolean;
  message: string;
  setMessage: (v: string) => void;
  onClose: () => void;
  onRefine: (text: string) => void;
  onStart: () => void;
}) {
  const summaryLine = [
    `${workout.exercises.length} EXERCISES`,
    workout.estimatedMinutes ? `~${workout.estimatedMinutes} MIN` : null,
    ...(workout.equipment ?? []).slice(0, 1).map((e) => e.toUpperCase()),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {view === "list" ? (
        <TopBar onClose={onClose} label="Built by FitBot" backIcon right="Built by FitBot" />
      ) : (
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-white/[0.03] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-[18px] w-[18px]" />
          </button>
          <div className="truncate px-2 text-[15px] font-bold">{name}</div>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border bg-white/[0.03] text-muted-foreground">
            <List className="h-[18px] w-[18px]" />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {view === "list" ? (
          <ListView
            workout={workout}
            name={name}
            setName={setName}
            newFlags={newFlags}
            summaryLine={summaryLine}
          />
        ) : (
          <ChatView
            workout={workout}
            transcript={transcript}
            lastChanges={lastChanges}
            newFlags={newFlags}
            refining={refining}
          />
        )}
      </div>

      {/* Docked refine + Start (shared by both views) */}
      <div className="flex flex-col gap-2.5 bg-gradient-to-t from-background via-background to-transparent px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
        {view === "list" && (
          <div className="flex gap-2 overflow-x-auto pb-0.5">
            {REFINE_CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={refining}
                onClick={() => onRefine(c)}
                className="shrink-0 rounded-full border bg-white/[0.05] px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <div className="flex h-[50px] items-center gap-2 rounded-2xl border-[1.5px] border-yellow bg-[#141412] pl-3.5 pr-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRefine(message);
            }}
            disabled={refining}
            placeholder={view === "list" ? "Ask FitBot to change anything…" : "Message FitBot…"}
            maxLength={1000}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-tertiary-foreground disabled:opacity-60"
            data-testid="input-fitbot-refine"
          />
          {/* Mic lands with the voice-input change. */}
          <button
            type="button"
            onClick={() => onRefine(message)}
            disabled={refining || !message.trim()}
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground disabled:opacity-40"
            data-testid="button-fitbot-send"
          >
            {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-[18px] w-[18px]" />}
          </button>
        </div>
        <button
          type="button"
          onClick={onStart}
          disabled={starting || workout.exercises.length === 0}
          className={CTA}
          data-testid="button-fitbot-start"
        >
          {starting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Setting up…
            </>
          ) : (
            <>
              <Play className="h-[19px] w-[19px] fill-current" />
              Start Workout
            </>
          )}
        </button>
      </div>
    </>
  );
}

function ListView({
  workout,
  name,
  setName,
  newFlags,
  summaryLine,
}: {
  workout: GeneratedWorkout;
  name: string;
  setName: (v: string) => void;
  newFlags: boolean[];
  summaryLine: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  return (
    <div className="mt-2 space-y-4">
      <div>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setName(draft.trim() || name);
                  setEditing(false);
                }
                if (e.key === "Escape") setEditing(false);
              }}
              maxLength={80}
              className="min-w-0 flex-1 rounded-lg border-strong bg-input px-3 h-11 text-[22px] font-bold outline-none focus:border-yellow focus:bg-input-focus"
              data-testid="input-fitbot-name"
            />
            <button
              type="button"
              aria-label="Save name"
              onClick={() => {
                setName(draft.trim() || name);
                setEditing(false);
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            >
              <Check className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-[25px] font-bold leading-tight tracking-[-0.02em]">{name}</h1>
            <button
              type="button"
              aria-label="Edit workout name"
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
              className="shrink-0 text-tertiary-foreground hover:text-foreground"
              data-testid="button-fitbot-edit-name"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="mt-1.5 font-mono text-xs tracking-[0.06em] text-muted-foreground">
          {summaryLine}
        </div>
        {(workout.targetMuscles ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {workout.targetMuscles.map((m) => (
              <span
                key={m}
                className="rounded-full border border-yellow bg-primary-dim px-2.5 py-1 text-xs text-primary"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="card-elevated overflow-hidden">
        {workout.exercises.map((ex, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 px-3.5 py-3 ${
              i < workout.exercises.length - 1 ? "border-b border-divider" : ""
            }`}
            data-testid={`fitbot-exercise-${i}`}
          >
            <div className="w-5 pt-0.5 font-mono text-[13px] font-bold text-tertiary-foreground">
              {String(i + 1).padStart(2, "0")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-semibold">{ex.name}</span>
                {newFlags[i] && <NewBadge />}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tracking-[0.03em] text-tertiary-foreground">
                {subline(ex)}
              </div>
            </div>
            <div className="shrink-0 font-mono text-[13px] font-semibold text-primary">
              {repsLabel(ex)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatView({
  workout,
  transcript,
  lastChanges,
  newFlags,
  refining,
}: {
  workout: GeneratedWorkout;
  transcript: ChatTurn[];
  lastChanges: WorkoutChange[];
  newFlags: boolean[];
  refining: boolean;
}) {
  // Map each change to the exercise it produced (matched by name) so we can
  // highlight the changed rows + show what they replaced.
  const changedByIndex = useMemo(() => {
    const map = new Map<number, WorkoutChange>();
    for (const ch of lastChanges) {
      if (ch.type === "remove") continue;
      const idx = workout.exercises.findIndex(
        (e) => e.name.toLowerCase() === ch.name.toLowerCase(),
      );
      if (idx >= 0) map.set(idx, ch);
    }
    return map;
  }, [lastChanges, workout]);

  const changedCount = changedByIndex.size;
  const unchanged = Math.max(0, workout.exercises.length - changedCount);
  const badgeFor = (t: WorkoutChange["type"]) =>
    t === "swap" ? "Swapped" : t === "add" ? "Added" : t === "modify" ? "Updated" : "Changed";

  return (
    <div className="mt-2 space-y-3.5">
      {transcript.map((turn, i) =>
        turn.role === "bot" ? (
          <div key={i} className="flex items-start gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-dim text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="max-w-[260px] rounded-[4px_14px_14px_14px] border bg-card px-3 py-2.5 text-[13px] leading-snug text-foreground/90">
              {turn.text}
            </div>
          </div>
        ) : (
          <div key={i} className="flex justify-end">
            <div className="max-w-[280px] rounded-[14px_14px_4px_14px] border border-yellow bg-primary-dim px-3 py-2.5 text-[13px] leading-snug text-foreground">
              {turn.text}
            </div>
          </div>
        ),
      )}

      {refining && (
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-dim text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </div>
          <div className="rounded-[4px_14px_14px_14px] border bg-card px-3 py-2.5 text-[13px] text-muted-foreground">
            Applying…
          </div>
        </div>
      )}

      {!refining && changedCount > 0 && (
        <>
          <div className="pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-tertiary-foreground">
            {changedCount} change{changedCount === 1 ? "" : "s"} applied
          </div>
          {[...changedByIndex.entries()].map(([idx, ch]) => {
            const ex = workout.exercises[idx];
            return (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-2xl border-[1.5px] border-yellow bg-primary-dim px-3.5 py-3"
                data-testid={`fitbot-changed-${idx}`}
              >
                <div className="w-5 pt-0.5 font-mono text-[13px] font-bold text-primary">
                  {String(idx + 1).padStart(2, "0")}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[15px] font-semibold">{ex.name}</span>
                    <span className="rounded bg-primary text-primary-foreground px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em]">
                      {badgeFor(ch.type)}
                    </span>
                    {newFlags[idx] && <NewBadge />}
                  </div>
                  {ch.previousName && (
                    <div className="mt-0.5 text-xs text-tertiary-foreground line-through">
                      was {ch.previousName}
                    </div>
                  )}
                </div>
                <div className="shrink-0 font-mono text-[13px] font-semibold text-primary">
                  {repsLabel(ex)}
                </div>
              </div>
            );
          })}
          {unchanged > 0 && (
            <div className="text-center text-[13px] text-tertiary-foreground">
              {unchanged} other exercise{unchanged === 1 ? "" : "s"} unchanged
            </div>
          )}
        </>
      )}
    </div>
  );
}
