"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Loader2, Check, ArrowRight } from "lucide-react";
import { DesktopTopBar } from "@/components/DesktopTopBar";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ImportedPlan, ResolvedExerciseReport } from "@/lib/import-schema";
import { planTrainingDayCount, planExerciseNames } from "@/lib/import-schema";
import { matchExercise } from "@/lib/exercise-match";
import { useQuery } from "@tanstack/react-query";

type Mode = "auto" | "workout" | "routine";

interface CommitResult {
  kind: "workout" | "routine";
  templateId?: string;
  routineId?: string;
  name: string;
  daysGenerated?: number;
  exercisesMatched: number;
  exercisesCreated: number;
  report: ResolvedExerciseReport[];
}

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // apiRequest surfaces "<status>: <body>"; show just the human part.
  // [\s\S] instead of the /s flag: the tsconfig target predates it.
  const m = /^\d+:\s*([\s\S]*)$/.exec(msg);
  const body = m ? m[1] : msg;
  try {
    const parsed = JSON.parse(body) as { error?: string; message?: string };
    return parsed.message || parsed.error || body;
  } catch {
    return body;
  }
}

interface CatalogRow {
  id: string;
  name: string;
}

/**
 * How each imported name will be handled, decided in the browser against the
 * catalog the page already has. Automatic matching alone is not enough: the 0.8
 * threshold is deliberately conservative and must not be lowered, so
 * "Barbell Bench Press" would otherwise be created as a near-duplicate of
 * "Bench Press". Anything between 0.6 and the threshold is shown as a
 * SUGGESTION for the user to accept or reject.
 */
interface Resolution {
  imported: string;
  /** Confident automatic match, above the real threshold. */
  auto: CatalogRow | null;
  /** Plausible but unconfirmed match, shown for a decision. */
  suggestion: CatalogRow | null;
}

// Deliberately below the old 0.6. Real near-misses from Ivo's import scored
// 0.67 ("Barbell Back Squats" vs "Barbell Squat") and 0.50 ("Barbell Row" vs
// "Bent Over Barbell Row"), and anything under the floor was created silently
// as a duplicate. Surfacing more candidates is safe because none of them
// auto-apply: each one has to be decided before the import can be saved.
const SUGGESTION_FLOOR = 0.5;

export default function ImportPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportedPlan | null>(null);
  const [planName, setPlanName] = useState("");
  const [result, setResult] = useState<CommitResult | null>(null);
  // importedName -> exerciseId to reuse, or null to create it anyway.
  const [choices, setChoices] = useState<Record<string, string | null>>({});
  // Run length in days. An imported plan is usually one cycle (a week); this is
  // how long the routine actually runs, with the pattern repeated to fill it.
  const [durationDays, setDurationDays] = useState<number | null>(null);

  const { data: catalog = [] } = useQuery<CatalogRow[]>({
    queryKey: ["/api/exercises"],
  });

  const resolutions: Resolution[] = plan
    ? planExerciseNames(plan).map((imported) => {
        const auto = matchExercise(imported, catalog);
        const suggestion = auto ? null : matchExercise(imported, catalog, SUGGESTION_FLOOR);
        return {
          imported,
          auto: auto ? { id: auto.id, name: auto.name } : null,
          suggestion: suggestion ? { id: suggestion.id, name: suggestion.name } : null,
        };
      })
    : [];

  // A near-match the user has not ruled on yet. Saving is blocked until each is
  // decided: leaving the default as "create new" is exactly how Ivo's import
  // quietly added "Barbell Back Squats or Front Squats" alongside his existing
  // "Barbell Squat". Fragmenting the catalog needs a merge migration to undo,
  // so an explicit choice is cheaper than the cleanup.
  const undecided = resolutions.filter(
    (r) => !r.auto && r.suggestion && choices[r.imported] === undefined,
  );
  const newCount = resolutions.filter(
    (r) => !r.auto && (choices[r.imported] === null || choices[r.imported] === undefined),
  ).length;
  const reuseCount = resolutions.length - newCount;

  const parse = async () => {
    setError(null);
    setResult(null);
    setIsParsing(true);
    try {
      const res = await apiRequest("POST", "/api/ai/import-parse", { text, mode });
      const data = (await res.json()) as { plan: ImportedPlan };
      setPlan(data.plan);
      setPlanName(data.plan.name);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setIsParsing(false);
    }
  };

  const commit = async () => {
    if (!plan) return;
    setError(null);
    setIsSaving(true);
    try {
      const res = await apiRequest("POST", "/api/import/commit", {
        plan,
        name: planName.trim() || undefined,
        mappings: choices,
        durationDays: durationDays ?? undefined,
      });
      const data = (await res.json()) as CommitResult;
      setResult(data);
      // The new row must show up on Routines / Home without a hard reload.
      queryClient.invalidateQueries({ queryKey: ["/api/routines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/exercises"] });
      toast({
        title: "Imported",
        description: `${data.name} is in your library.`,
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setIsSaving(false);
    }
  };

  const reset = () => {
    setPlan(null);
    setResult(null);
    setError(null);
    setText("");
    setChoices({});
    setDurationDays(null);
  };

  const modeButton = (value: Mode, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setMode(value)}
      className={`h-9 rounded-lg px-3 font-mono text-[11px] uppercase tracking-wider transition-colors ${
        mode === value
          ? "border border-yellow bg-primary-dim text-primary"
          : "border border-strong text-tertiary-foreground"
      }`}
      data-testid={`import-mode-${value}`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full overflow-auto">
      <DesktopTopBar title="Import" />
      <div className="container mx-auto max-w-3xl space-y-5 p-4 sm:p-6 md:pt-7">
        <div className="md:hidden">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">Import</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a plan from anywhere
          </p>
        </div>

        {!plan && !result && (
          <div className="card-elevated space-y-4 p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">
              Paste a workout or program from another app, a website, a coach, or
              a chat with an AI. Plain text, a copied table or JSON all work.
              FitYear matches the exercises to your library and creates any that
              are missing.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-tertiary-foreground">
                Treat as
              </span>
              {modeButton("auto", "Auto")}
              {modeButton("workout", "One workout")}
              {modeButton("routine", "Program")}
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Day 1 - Push\nBench Press 4x5, rest 3 min\nIncline DB Press 3x8-12\n..."}
              rows={12}
              className="w-full rounded-xl border border-strong bg-transparent p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-yellow"
              data-testid="import-textarea"
            />

            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-tertiary-foreground">
                {text.length.toLocaleString()} / 24,000
              </span>
              <button
                type="button"
                onClick={parse}
                disabled={text.trim().length < 10 || isParsing}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-cta disabled:opacity-40"
                data-testid="import-parse-button"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reading...
                  </>
                ) : (
                  <>
                    <ClipboardPaste className="h-4 w-4" />
                    Read plan
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
            data-testid="import-error"
          >
            {error}
          </div>
        )}

        {plan && !result && (
          <div className="card-elevated space-y-4 p-4 sm:p-5" data-testid="import-preview">
            <div className="space-y-2">
              <label
                htmlFor="import-name"
                className="font-mono text-[11px] uppercase tracking-wider text-tertiary-foreground"
              >
                Name
              </label>
              <input
                id="import-name"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                className="w-full rounded-xl border border-strong bg-transparent px-3 py-2 text-sm outline-none focus:border-yellow"
                data-testid="import-name-input"
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <div>
                <div className="font-mono text-[17px] font-bold text-primary" data-testid="import-kind">
                  {plan.kind === "workout" ? "Workout" : "Program"}
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-tertiary-foreground">
                  Type
                </div>
              </div>
              <div>
                <div className="font-mono text-[17px] font-bold" data-testid="import-day-count">
                  {planTrainingDayCount(plan)}
                </div>
                <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-tertiary-foreground">
                  {plan.kind === "workout" ? "Session" : "Training days"}
                </div>
              </div>
            </div>

            <div className="max-h-[45vh] space-y-3 overflow-auto rounded-xl border border-divider p-3">
              {plan.kind === "workout"
                ? plan.exercises.map((ex, i) => (
                    <div key={`${ex.name}-${i}`} className="flex items-baseline justify-between gap-3">
                      <span className="text-sm">{ex.name}</span>
                      <span className="shrink-0 font-mono text-xs text-tertiary-foreground">
                        {ex.sets} x {ex.reps}
                      </span>
                    </div>
                  ))
                : plan.days.map((day) => (
                    <div key={day.dayIndex}>
                      <div className="font-mono text-[11px] uppercase tracking-wider text-primary">
                        Day {day.dayIndex} · {day.workoutName}
                      </div>
                      {day.isRest ? (
                        <div className="mt-1 text-sm text-tertiary-foreground">Rest</div>
                      ) : (
                        <div className="mt-1 space-y-1">
                          {day.exercises.map((ex, i) => (
                            <div key={`${ex.name}-${i}`} className="flex items-baseline justify-between gap-3">
                              <span className="text-sm">{ex.name}</span>
                              <span className="shrink-0 font-mono text-xs text-tertiary-foreground">
                                {ex.sets} x {ex.reps}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
            </div>

            {/* Exercise resolution: what will be reused vs newly created. The
                whole point is that the user sees this BEFORE anything is
                written, so an import cannot quietly fragment the catalog. */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] uppercase tracking-wider text-tertiary-foreground">
                  Exercises
                </span>
                <span className="font-mono text-[11px] text-tertiary-foreground" data-testid="import-resolution-counts">
                  {reuseCount} reused · {newCount} new
                </span>
              </div>
              <div className="max-h-[35vh] space-y-1.5 overflow-auto rounded-xl border border-divider p-3">
                {resolutions.map((r) => {
                  const chosen = choices[r.imported];
                  const reusing =
                    r.auto ?? (chosen ? catalog.find((c) => c.id === chosen) ?? null : null);
                  return (
                    <div
                      key={r.imported}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
                      data-testid={`import-resolution-${r.imported}`}
                    >
                      <span className="text-sm">
                        {r.imported}
                        {reusing && reusing.name !== r.imported && (
                          <span className="text-tertiary-foreground"> → {reusing.name}</span>
                        )}
                      </span>

                      {r.auto ? (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-tertiary-foreground">
                          Matched
                        </span>
                      ) : r.suggestion && chosen === undefined ? (
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-tertiary-foreground">
                            Looks like {r.suggestion.name}?
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setChoices((c) => ({ ...c, [r.imported]: r.suggestion!.id }))
                            }
                            className="h-7 rounded-md border border-yellow bg-primary-dim px-2 font-mono text-[10px] uppercase tracking-wider text-primary"
                            data-testid={`import-use-existing-${r.imported}`}
                          >
                            Use it
                          </button>
                          <button
                            type="button"
                            onClick={() => setChoices((c) => ({ ...c, [r.imported]: null }))}
                            className="h-7 rounded-md border border-strong px-2 font-mono text-[10px] uppercase tracking-wider text-tertiary-foreground"
                            data-testid={`import-create-new-${r.imported}`}
                          >
                            Keep new
                          </button>
                        </span>
                      ) : chosen ? (
                        <button
                          type="button"
                          onClick={() =>
                            setChoices((c) => {
                              const next = { ...c };
                              delete next[r.imported];
                              return next;
                            })
                          }
                          className="font-mono text-[10px] uppercase tracking-wider text-primary underline"
                          data-testid={`import-undo-${r.imported}`}
                        >
                          Reusing · undo
                        </button>
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
                          New
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {plan.kind === "routine" && (
              <div className="space-y-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-tertiary-foreground">
                  Run this for
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { v: null, label: `As imported (${plan.days.length}d)` },
                    { v: 30, label: "30 days" },
                    { v: 60, label: "60 days" },
                    { v: 90, label: "90 days" },
                  ].map((opt) => (
                    <button
                      key={String(opt.v)}
                      type="button"
                      onClick={() => setDurationDays(opt.v)}
                      className={`h-9 rounded-lg px-3 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                        durationDays === opt.v
                          ? "border border-yellow bg-primary-dim text-primary"
                          : "border border-strong text-tertiary-foreground"
                      }`}
                      data-testid={`import-duration-${opt.v ?? "asis"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {durationDays !== null && (
                  <p className="text-xs text-tertiary-foreground">
                    The {plan.cycleLength}-day pattern repeats to fill {durationDays} days.
                  </p>
                )}
              </div>
            )}

            {undecided.length > 0 && (
              <div
                className="rounded-xl border border-yellow bg-primary-dim p-3 text-sm"
                data-testid="import-undecided-warning"
              >
                {undecided.length} exercise{undecided.length === 1 ? "" : "s"} look like
                {undecided.length === 1 ? "s" : ""} something already in your library.
                Choose <span className="text-primary">Use it</span> or{" "}
                <span className="text-primary">Keep new</span> for each before saving, so
                the import does not create duplicates.
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={reset}
                className="h-11 rounded-xl border border-strong px-4 text-sm font-semibold"
                data-testid="import-cancel"
              >
                Start over
              </button>
              <button
                type="button"
                onClick={commit}
                disabled={isSaving || undecided.length > 0}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-cta disabled:opacity-40"
                data-testid="import-save-button"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Add to FitYear
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="card-elevated space-y-4 p-4 sm:p-5" data-testid="import-result">
            <div>
              <div className="text-base font-bold">{result.name}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.kind === "routine"
                  ? `${result.daysGenerated} training days added to your routines.`
                  : "Added to your workouts."}{" "}
                <span data-testid="import-result-counts">
                  {result.exercisesMatched} matched to your library,{" "}
                  {result.exercisesCreated} newly created.
                </span>
              </p>
            </div>

            <div className="max-h-[35vh] space-y-1 overflow-auto rounded-xl border border-divider p-3">
              {result.report.map((r) => (
                <div key={r.imported} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">
                    {r.imported}
                    {r.resolved !== r.imported && (
                      <span className="text-tertiary-foreground"> → {r.resolved}</span>
                    )}
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${
                      r.action === "created" ? "text-primary" : "text-tertiary-foreground"
                    }`}
                  >
                    {r.action === "created" ? "New" : "Matched"}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={reset}
                className="h-11 rounded-xl border border-strong px-4 text-sm font-semibold"
                data-testid="import-another"
              >
                Import another
              </button>
              <button
                type="button"
                onClick={() => router.push(result.kind === "routine" ? "/routines" : "/")}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-cta"
                data-testid="import-goto"
              >
                {result.kind === "routine" ? "View routines" : "View workouts"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
