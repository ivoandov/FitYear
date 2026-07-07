"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  X,
  Check,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { apiRequest, describeApiError } from "@/lib/queryClient";
import { ProgramSchema, type Program } from "@/lib/program-schema";

type Step =
  | "focus"
  | "equipment"
  | "experience"
  | "extras"
  | "imbalances"
  | "injuries"
  | "summary"
  | "generating"
  | "preview"
  | "error";

const FOCUS = ["Strength", "Hypertrophy", "Calisthenics", "Flexibility", "Mixed", "Athletic"];
const EQUIPMENT = ["Full Gym", "Home + Weights", "Bodyweight", "Resistance Bands"];
const EXPERIENCE = ["Beginner", "Intermediate", "Advanced", "Competitive"] as const;
const EXTRA_PRESETS = [
  "Lose body fat",
  "Improve cardio",
  "Build muscle",
  "Get stronger",
  "Train around injury",
  "Fix muscle imbalances",
];
const MUSCLE_AREAS = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"];
const INJURY_AREAS = ["Lower back", "Knees", "Shoulders", "Wrists", "Elbows", "Neck", "Hips", "Ankles"];

interface UserSettings {
  onboardingDaysPerWeek?: number | null;
  onboardingProgramLength?: number | null;
  fitbotDefaultFocus?: string | null;
}

export default function FitBotPage() {
  const router = useRouter();
  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/user-settings"],
  });

  const [step, setStep] = useState<Step>("focus");
  const [focus, setFocus] = useState<string[]>(() =>
    userSettings?.fitbotDefaultFocus ? [userSettings.fitbotDefaultFocus] : [],
  );
  const [equipment, setEquipment] = useState<string[]>([]);
  const [experience, setExperience] =
    useState<typeof EXPERIENCE[number] | null>(null);
  const [extras, setExtras] = useState<string[]>([]);
  const [extraCustom, setExtraCustom] = useState("");
  const [imbalanceMuscles, setImbalanceMuscles] = useState<string[]>([]);
  const [imbalanceNotes, setImbalanceNotes] = useState("");
  const [injuryDetails, setInjuryDetails] = useState<string[]>([]);
  const [injuryNotes, setInjuryNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    routineId: string;
    name: string;
    weeksGenerated: number;
    daysGenerated: number;
    program: Program;
  } | null>(null);

  const daysPerWeek = userSettings?.onboardingDaysPerWeek ?? 4;
  const programLength = userSettings?.onboardingProgramLength ?? 60;

  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function handleNext(from: Step) {
    setError(null);
    if (from === "extras") {
      const wantImbalances = extras.includes("Fix muscle imbalances");
      const wantInjuries = extras.includes("Train around injury");
      if (wantImbalances) setStep("imbalances");
      else if (wantInjuries) setStep("injuries");
      else setStep("summary");
    } else if (from === "imbalances") {
      const wantInjuries = extras.includes("Train around injury");
      setStep(wantInjuries ? "injuries" : "summary");
    } else if (from === "injuries") {
      setStep("summary");
    }
  }

  const [streamedChars, setStreamedChars] = useState(0);
  // Keep the last successfully-generated program so a SAVE failure can retry
  // the save without re-running (and re-billing) the LLM generation.
  const [generatedProgram, setGeneratedProgram] = useState<Program | null>(null);
  const [errorStage, setErrorStage] = useState<"generate" | "save">("generate");
  const abortRef = useRef<AbortController | null>(null);
  const cancelledByUserRef = useRef(false);

  // Persist a validated program to the user's routines. Separated from
  // generation so a save failure retries only this step.
  async function saveProgram(program: Program) {
    setStep("generating");
    try {
      const saveRes = await apiRequest("POST", "/api/ai/save-program", {
        program,
        focus,
        experience,
        programLength,
      });
      const saved = await saveRes.json();
      setResult({ ...saved, program });
      setStep("preview");
    } catch (e) {
      setErrorStage("save");
      setError(describeApiError(e));
      setStep("error");
    }
  }

  function handleCancel() {
    cancelledByUserRef.current = true;
    abortRef.current?.abort();
    setStep("summary");
  }

  async function handleGenerate() {
    if (!experience) {
      setError("Pick an experience level first");
      setStep("experience");
      return;
    }
    setStep("generating");
    setError(null);
    setStreamedChars(0);
    setErrorStage("generate");
    cancelledByUserRef.current = false;

    // Abort generation after 90s (or on user Cancel) so a hung stream can't
    // pin the "building" screen forever.
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      // Stream the JSON from Anthropic. The function returns immediately with
      // a streaming Response, which dodges the 60s blank-wall timeout we used
      // to hit. We accumulate the text client-side and parse once it's done.
      const res = await fetch("/api/ai/generate-program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          focus,
          equipment,
          experience,
          daysPerWeek,
          programLength,
          extras,
          imbalanceMuscles,
          imbalanceNotes,
          injuryDetails,
          injuryNotes,
        }),
      });
      if (!res.ok || !res.body) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        setStreamedChars(raw.length);
      }

      // Robust extraction: slice from the first `{` to the last `}` so leading
      // or trailing prose / code fences don't break the parse (the old code
      // only stripped a fence if it was the very first character).
      const first = raw.indexOf("{");
      const last = raw.lastIndexOf("}");
      if (first < 0 || last <= first) {
        throw new Error("Fit Bot didn't return a program. Please try again.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.slice(first, last + 1));
      } catch {
        throw new Error("Fit Bot returned invalid JSON. Please try again.");
      }
      const validated = ProgramSchema.safeParse(parsed);
      if (!validated.success) {
        throw new Error("Fit Bot's program was incomplete. Please try again.");
      }

      // Generation succeeded: stash the program, then save it. A save failure
      // from here re-tries the save only (see the error screen).
      setGeneratedProgram(validated.data);
      await saveProgram(validated.data);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        // A user Cancel already routed to the summary screen; don't flip to
        // the error screen. A timeout abort DOES surface as an error.
        if (cancelledByUserRef.current) {
          cancelledByUserRef.current = false;
          return;
        }
        setError("Generation timed out. Please try again.");
      } else {
        setError((e as Error).message);
      }
      setErrorStage("generate");
      setStep("error");
    } finally {
      clearTimeout(timeoutId);
      abortRef.current = null;
    }
  }

  return (
    <main className="flex flex-1 flex-col p-5 sm:p-8">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/routines")}
          className="flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4 mr-1" />
          Close
        </button>
        <div className="flex items-center gap-1.5 text-sm text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          Fit Bot
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center max-w-md w-full mx-auto py-8 space-y-6">
        {step === "focus" && (
          <Step
            title="What's your training focus?"
            hint="Pick one or more"
          >
            <ChipGrid
              options={FOCUS}
              selected={focus}
              onToggle={(v) => setFocus((s) => toggle(s, v))}
            />
            <NextRow
              disabled={focus.length === 0}
              onNext={() => setStep("equipment")}
            />
          </Step>
        )}

        {step === "equipment" && (
          <Step title="What equipment do you have?" hint="Pick all that apply">
            <ChipGrid
              options={EQUIPMENT}
              selected={equipment}
              onToggle={(v) => setEquipment((s) => toggle(s, v))}
            />
            <NextRow
              disabled={equipment.length === 0}
              onBack={() => setStep("focus")}
              onNext={() => setStep("experience")}
            />
          </Step>
        )}

        {step === "experience" && (
          <Step title="What's your experience level?" hint="Pick one">
            <div className="grid grid-cols-2 gap-2">
              {EXPERIENCE.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setExperience(e);
                    setStep("extras");
                  }}
                  className={`rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                    experience === e
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:border-primary"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <NextRow onBack={() => setStep("equipment")} />
          </Step>
        )}

        {step === "extras" && (
          <Step title="Anything else?" hint="Optional — pick any that apply">
            <ChipGrid
              options={EXTRA_PRESETS}
              selected={extras}
              onToggle={(v) => setExtras((s) => toggle(s, v))}
            />
            <div className="flex gap-2">
              <Input
                placeholder="Add custom goal..."
                value={extraCustom}
                onChange={(e) => setExtraCustom(e.target.value)}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={() => {
                  if (extraCustom.trim()) {
                    setExtras((s) => [...s, extraCustom.trim()]);
                    setExtraCustom("");
                  }
                }}
              >
                Add
              </Button>
            </div>
            <NextRow
              onBack={() => setStep("experience")}
              onNext={() => handleNext("extras")}
            />
          </Step>
        )}

        {step === "imbalances" && (
          <Step
            title="Which muscles need extra work?"
            hint="Pick areas you want to bring up"
          >
            <ChipGrid
              options={MUSCLE_AREAS}
              selected={imbalanceMuscles}
              onToggle={(v) => setImbalanceMuscles((s) => toggle(s, v))}
            />
            <Textarea
              placeholder="Anything specific? (e.g. weak left side, lagging glutes)"
              value={imbalanceNotes}
              onChange={(e) => setImbalanceNotes(e.target.value)}
              rows={3}
            />
            <NextRow
              onBack={() => setStep("extras")}
              onNext={() => handleNext("imbalances")}
            />
          </Step>
        )}

        {step === "injuries" && (
          <Step
            title="What injuries should we work around?"
            hint="So Fit Bot can pick safe alternatives"
          >
            <ChipGrid
              options={INJURY_AREAS}
              selected={injuryDetails}
              onToggle={(v) => setInjuryDetails((s) => toggle(s, v))}
            />
            <Textarea
              placeholder="Specifics? (e.g. avoid heavy squats, no overhead pressing)"
              value={injuryNotes}
              onChange={(e) => setInjuryNotes(e.target.value)}
              rows={3}
            />
            <NextRow
              onBack={() =>
                extras.includes("Fix muscle imbalances")
                  ? setStep("imbalances")
                  : setStep("extras")
              }
              onNext={() => handleNext("injuries")}
            />
          </Step>
        )}

        {step === "summary" && (
          <Step title="Ready to build your program?" hint="Review and tweak">
            <SummaryRow label="Focus" value={focus.join(", ")} onEdit={() => setStep("focus")} />
            <SummaryRow label="Equipment" value={equipment.join(", ")} onEdit={() => setStep("equipment")} />
            <SummaryRow label="Experience" value={experience ?? "—"} onEdit={() => setStep("experience")} />
            <SummaryRow label="Extras" value={extras.join(", ") || "none"} onEdit={() => setStep("extras")} />
            {extras.includes("Fix muscle imbalances") && (
              <SummaryRow
                label="Imbalances"
                value={imbalanceMuscles.join(", ") + (imbalanceNotes ? ` · ${imbalanceNotes}` : "")}
                onEdit={() => setStep("imbalances")}
              />
            )}
            {extras.includes("Train around injury") && (
              <SummaryRow
                label="Injuries"
                value={injuryDetails.join(", ") + (injuryNotes ? ` · ${injuryNotes}` : "")}
                onEdit={() => setStep("injuries")}
              />
            )}
            <SummaryRow label="Days/week" value={`${daysPerWeek}`} onEdit={undefined} />
            <SummaryRow label="Program length" value={`${programLength} days`} onEdit={undefined} />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <Button
              onClick={handleGenerate}
              className="h-12 w-full"
              disabled={!focus.length || !equipment.length || !experience}
            >
              Generate My Program
            </Button>
            <button
              type="button"
              onClick={() => setStep("focus")}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="inline h-3 w-3 mr-1" /> Start over
            </button>
          </Step>
        )}

        {step === "generating" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <h2 className="text-xl font-semibold">Fit Bot is building your program…</h2>
            <p className="text-sm text-muted-foreground">
              Drafting a {programLength}-day {focus.join(" + ")} plan. This usually
              takes 15–30 seconds.
            </p>
            {streamedChars > 0 ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {streamedChars.toLocaleString()} characters drafted
              </p>
            ) : null}
            <Button variant="outline" onClick={handleCancel} className="mt-2">
              Cancel
            </Button>
          </div>
        )}

        {step === "preview" && result && (
          <Step
            title={result.name}
            hint={`${result.weeksGenerated} weeks · ${result.daysGenerated} workouts · saved to your routines`}
          >
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-1.5 text-primary font-semibold text-sm">
                <Sparkles className="h-4 w-4" />
                Built for you
              </div>
              <p className="text-sm text-muted-foreground">
                Tap "Open Routine" to see all {result.weeksGenerated} weeks. From there,
                you can edit any day or start the program.
              </p>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Week 1 preview</h3>
              {result.program.weeks[0]?.days.map((d, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <div>
                    <div className="font-medium">{d.dayOfWeek}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.isRest ? "Rest day" : d.workoutName}
                    </div>
                  </div>
                  {!d.isRest ? (
                    <div className="text-xs text-muted-foreground">
                      {d.exercises.length} exercises
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <Button
              onClick={() => router.push(`/routines`)}
              className="h-12 w-full"
            >
              <Check className="h-4 w-4 mr-2" />
              Open in Routines
            </Button>
          </Step>
        )}

        {step === "error" && (
          <Step
            title="Something went wrong"
            hint={
              errorStage === "save"
                ? "Your program was generated but couldn't be saved"
                : "Fit Bot couldn't finish the program"
            }
          >
            <p className="text-sm text-destructive">{error}</p>
            {errorStage === "save" && generatedProgram ? (
              // Generation already succeeded (and was paid for) — retry only the
              // save so we don't regenerate.
              <Button
                onClick={() => saveProgram(generatedProgram)}
                className="h-12 w-full"
              >
                Retry save
              </Button>
            ) : (
              <Button onClick={handleGenerate} className="h-12 w-full">
                Try again
              </Button>
            )}
          </Step>
        )}
      </div>
    </main>
  );
}

function Step({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold">{title}</h1>
        {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function ChipGrid({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:border-primary"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function NextRow({
  disabled,
  onBack,
  onNext,
}: {
  disabled?: boolean;
  onBack?: () => void;
  onNext?: () => void;
}) {
  if (!onNext && !onBack) return null;
  return (
    <div className="flex items-center justify-between pt-2">
      {onBack ? (
        <button
          onClick={onBack}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </button>
      ) : (
        <div />
      )}
      {onNext ? (
        <Button onClick={onNext} disabled={disabled} className="h-10 px-6">
          Next <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      ) : null}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: (() => void) | undefined;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border pb-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="text-sm">{value || "—"}</p>
      </div>
      {onEdit ? (
        <button
          onClick={onEdit}
          className="text-xs text-primary hover:underline"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}
