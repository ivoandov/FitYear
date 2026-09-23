"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Check,
  Loader2,
  AlertTriangle,
  RotateCw,
  Plus,
  Info,
} from "lucide-react";
import { apiRequest, describeApiError } from "@/lib/queryClient";
import { assembleProgram } from "@/lib/program-assembler";
import { ProgramDayList } from "@/components/ProgramDayList";
import type { WeightUnit } from "@/lib/units";
import type { Skeleton, PhaseVariety, Program } from "@/lib/program-schema";

// The refresh's neon primary CTA (same treatment as the single-workout flow).
const CTA =
  "h-14 w-full rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-primary-foreground font-bold text-base shadow-cta-strong disabled:opacity-60 flex items-center justify-center gap-2";

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

type WizardStep =
  | "focus"
  | "equipment"
  | "experience"
  | "schedule"
  | "extras"
  | "imbalances"
  | "injuries"
  | "summary";
type Screen = WizardStep | "building" | "review" | "preview";

type StepStatus = "queued" | "building" | "done" | "failed";
interface PhaseState {
  name: string;
  startWeek: number;
  endWeek: number;
  status: StepStatus;
  error?: string;
}

interface UserSettings {
  onboardingDaysPerWeek?: number | null;
  onboardingProgramLength?: number | null;
  fitbotDefaultFocus?: string | null;
  weightUnit?: string | null;
}

// The wizard's step path is dynamic: imbalances/injuries only appear if the user
// opted into them, so the "Step n of N" + progress bar reflect the real path.
function wizardSequence(extras: string[]): WizardStep[] {
  const seq: WizardStep[] = ["focus", "equipment", "experience", "schedule", "extras"];
  if (extras.includes("Fix muscle imbalances")) seq.push("imbalances");
  if (extras.includes("Train around injury")) seq.push("injuries");
  seq.push("summary");
  return seq;
}

export default function FitBotProgramPage() {
  const router = useRouter();
  const { data: userSettings } = useQuery<UserSettings>({
    queryKey: ["/api/user-settings"],
  });

  const [screen, setScreen] = useState<Screen>("focus");
  const [focus, setFocus] = useState<string[]>(() =>
    userSettings?.fitbotDefaultFocus ? [userSettings.fitbotDefaultFocus] : [],
  );
  const [equipment, setEquipment] = useState<string[]>([]);
  const [experience, setExperience] = useState<(typeof EXPERIENCE)[number] | null>(null);
  const [extras, setExtras] = useState<string[]>([]);
  const [extraCustom, setExtraCustom] = useState("");
  const [imbalanceMuscles, setImbalanceMuscles] = useState<string[]>([]);
  const [imbalanceNotes, setImbalanceNotes] = useState("");
  const [injuryDetails, setInjuryDetails] = useState<string[]>([]);
  const [injuryNotes, setInjuryNotes] = useState("");

  // Segmented build state.
  const skeletonRef = useRef<Skeleton | null>(null);
  // Issued by the (metered) skeleton call and required by every phase call, so
  // the unmetered stage-2 endpoint can't be driven without a charged build.
  const buildTokenRef = useRef<string | null>(null);
  const varietyRef = useRef<(PhaseVariety | null)[]>([]);
  const [structureStatus, setStructureStatus] = useState<StepStatus>("queued");
  const [structureError, setStructureError] = useState<string | null>(null);
  const [phases, setPhases] = useState<PhaseState[]>([]);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  /**
   * The program as built, BEFORE anything is written.
   *
   * The builder used to save the moment generation finished and then show a
   * list of day names, so the only way to change anything was to accept a
   * program you could not read. Now the draft lives here, the review screen
   * renders it in full, and refining it is a conversation. Saving is a button.
   */
  const [draft, setDraft] = useState<{
    skeleton: Skeleton;
    variety: (PhaseVariety | null)[];
    program: Program;
  } | null>(null);
  const [refineTurns, setRefineTurns] = useState<
    { role: "user" | "fitbot"; text: string }[]
  >([]);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    routineId: string;
    name: string;
    cycleLength: number;
    distinctWorkouts: number | null;
    weeksGenerated: number;
    daysGenerated: number;
    program: Program;
  } | null>(null);

  // Distinct workouts + program length + free-form structure notes are all
  // user-editable in the wizard (Schedule step). The count of distinct workouts
  // and program length seed once from the onboarding settings when they load
  // (onboardingDaysPerWeek is a reasonable proxy for how many distinct workouts
  // to rotate, clamped to the 3-8 range). Any later user edit wins (the ref
  // guards against re-seeding on subsequent settings refetches).
  const [distinctWorkouts, setDistinctWorkouts] = useState(4);
  const [programLength, setProgramLength] = useState(60);
  const [structureNotes, setStructureNotes] = useState("");
  const seededScheduleRef = useRef(false);
  useEffect(() => {
    if (seededScheduleRef.current || !userSettings) return;
    seededScheduleRef.current = true;
    if (userSettings.onboardingDaysPerWeek != null)
      setDistinctWorkouts(Math.min(8, Math.max(3, userSettings.onboardingDaysPerWeek)));
    if (userSettings.onboardingProgramLength != null)
      setProgramLength(userSettings.onboardingProgramLength);
  }, [userSettings]);

  const sequence = useMemo(() => wizardSequence(extras), [extras]);

  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  function handleNext(from: WizardStep) {
    if (from === "extras") {
      if (extras.includes("Fix muscle imbalances")) setScreen("imbalances");
      else if (extras.includes("Train around injury")) setScreen("injuries");
      else setScreen("summary");
    } else if (from === "imbalances") {
      setScreen(extras.includes("Train around injury") ? "injuries" : "summary");
    } else if (from === "injuries") {
      setScreen("summary");
    }
  }

  function close() {
    router.back();
  }

  // ---- segmented generation --------------------------------------------

  const constraints = () => ({
    equipment,
    experience,
    extras,
    imbalanceMuscles,
    imbalanceNotes,
    injuryDetails,
    injuryNotes,
  });

  function setPhaseStatus(i: number, status: StepStatus, error?: string) {
    setPhases((prev) => prev.map((p, idx) => (idx === i ? { ...p, status, error } : p)));
  }

  async function buildPhaseCall(sk: Skeleton, i: number): Promise<PhaseVariety> {
    const res = await apiRequest("POST", "/api/ai/generate-program-phase", {
      skeleton: sk,
      phaseIndex: i,
      buildToken: buildTokenRef.current ?? "",
      ...constraints(),
    });
    const data = (await res.json()) as { phaseIndex: number; variety: PhaseVariety };
    return data.variety;
  }

  // Build phases sequentially from `start`; stop on the first failure (the user
  // retries just that phase, which resumes from there). When every phase is
  // done, assemble + save.
  async function runPhasesFrom(sk: Skeleton, start: number) {
    for (let i = start; i < sk.phases.length; i++) {
      setPhaseStatus(i, "building");
      try {
        varietyRef.current[i] = await buildPhaseCall(sk, i);
        setPhaseStatus(i, "done");
      } catch (e) {
        // One silent retry before handing the user a failure. Ivo hit this
        // building his first program: a single phase failed, he pressed retry,
        // and it worked - which is the signature of a transient model error
        // (a 529 overloaded), not of anything he did. The phase endpoint is
        // unmetered and bound to an already-charged build, so a retry costs
        // seconds rather than a quota unit.
        try {
          varietyRef.current[i] = await buildPhaseCall(sk, i);
          setPhaseStatus(i, "done");
          continue;
        } catch {
          setPhaseStatus(i, "failed", describeApiError(e));
          return;
        }
      }
    }
    review(sk);
  }

  /**
   * Generation finished. Show it; do not save it.
   *
   * Ivo, 2026-09-22: "The user needs to feel like they are conversing and
   * iterating and have the full ability to see what FitBot is making,
   * recommend any changes, and make any tweaks before the routine is saved."
   */
  function review(sk: Skeleton) {
    const program = assembleProgram({ skeleton: sk, variety: varietyRef.current });
    setDraft({ skeleton: sk, variety: [...varietyRef.current], program });
    setRefineTurns([]);
    setRefineError(null);
    setScreen("review");
  }

  /** One conversational change to the unsaved draft. */
  async function refine(instruction: string) {
    if (!draft || refining) return;
    setRefining(true);
    setRefineError(null);
    setRefineTurns((t) => [...t, { role: "user", text: instruction }]);
    try {
      const res = await apiRequest("POST", "/api/ai/refine-program", {
        skeleton: draft.skeleton,
        variety: draft.variety.filter((v): v is PhaseVariety => v != null),
        instruction,
        context: buildContext(),
      });
      const data = (await res.json()) as {
        skeleton: Skeleton;
        variety: PhaseVariety[];
        summary: string;
      };
      // Re-assembled in code, so every week's loads are recomputed the same way
      // they were at build time rather than by the model.
      const program = assembleProgram({ skeleton: data.skeleton, variety: data.variety });
      setDraft({ skeleton: data.skeleton, variety: data.variety, program });
      setRefineTurns((t) => [...t, { role: "fitbot", text: data.summary }]);
    } catch (e) {
      setRefineError(describeApiError(e));
    } finally {
      setRefining(false);
    }
  }

  /** What they asked for at the start, so a refine does not undo the brief. */
  function buildContext(): string {
    return [
      focus.length ? `Focus: ${focus.join(", ")}.` : "",
      equipment.length ? `Equipment: ${equipment.join(", ")}.` : "",
      experience ? `Experience: ${experience}.` : "",
      structureNotes ? `Structure notes: ${structureNotes}` : "",
      injuryNotes ? `Injuries: ${injuryNotes}` : "",
      imbalanceNotes ? `Imbalances: ${imbalanceNotes}` : "",
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 4000);
  }

  async function finalize(sk: Skeleton) {
    setFinalizing(true);
    setFinalizeError(null);
    try {
      const program = draft?.program ?? assembleProgram({ skeleton: sk, variety: varietyRef.current });
      const res = await apiRequest("POST", "/api/ai/save-program", {
        program,
        focus,
        experience,
        programLength,
        distinctWorkouts,
      });
      const saved = (await res.json()) as {
        routineId: string;
        name: string;
        cycleLength: number;
        distinctWorkouts: number | null;
        weeksGenerated: number;
        daysGenerated: number;
      };
      setResult({ ...saved, program });
      setScreen("preview");
    } catch (e) {
      setFinalizeError(describeApiError(e));
    } finally {
      setFinalizing(false);
    }
  }

  async function startBuild() {
    if (!experience) {
      setScreen("experience");
      return;
    }
    setScreen("building");
    setStructureStatus("building");
    setStructureError(null);
    setFinalizeError(null);
    setPhases([]);
    varietyRef.current = [];
    skeletonRef.current = null;
    buildTokenRef.current = null;
    try {
      const res = await apiRequest("POST", "/api/ai/generate-program-skeleton", {
        focus,
        distinctWorkouts,
        programLength,
        structureNotes,
        ...constraints(),
      });
      const sk = (await res.json()) as Skeleton & { buildToken?: string };
      buildTokenRef.current = sk.buildToken ?? null;
      skeletonRef.current = sk;
      varietyRef.current = sk.phases.map(() => null);
      setPhases(
        sk.phases.map((p) => ({
          name: p.name,
          startWeek: p.startWeek,
          endWeek: p.endWeek,
          status: "queued" as StepStatus,
        })),
      );
      setStructureStatus("done");
      await runPhasesFrom(sk, 0);
    } catch (e) {
      setStructureStatus("failed");
      setStructureError(describeApiError(e));
    }
  }

  function retryPhase(i: number) {
    const sk = skeletonRef.current;
    if (!sk) return;
    setFinalizeError(null);
    runPhasesFrom(sk, i);
  }

  function retrySave() {
    const sk = skeletonRef.current;
    if (sk) finalize(sk);
  }

  // ---- render -----------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)]">
      {/* The wizard is an immersive single-column flow; on desktop center it in a
          focused column (with hairline sides) instead of stretching full-width. */}
      <div className="mx-auto flex w-full flex-1 flex-col overflow-hidden md:max-w-xl md:border-x md:border-divider">
        {screen === "building" ? (
          <BuildingScreen
            structureStatus={structureStatus}
            structureError={structureError}
            phases={phases}
            finalizing={finalizing}
            finalizeError={finalizeError}
            onCancel={() => setScreen("summary")}
            onRetryStructure={startBuild}
            onRetryPhase={retryPhase}
            onRetrySave={retrySave}
          />
        ) : screen === "review" && draft ? (
          <ReviewScreen
            program={draft.program}
            weightUnit={(userSettings?.weightUnit === "kg" ? "kg" : "lbs") as WeightUnit}
            turns={refineTurns}
            refining={refining}
            error={refineError}
            saving={finalizing}
            saveError={finalizeError}
            onRefine={refine}
            onSave={() => finalize(draft.skeleton)}
            onClose={close}
          />
        ) : screen === "preview" && result ? (
          <PreviewScreen
            result={result}
            weightUnit={(userSettings?.weightUnit === "kg" ? "kg" : "lbs") as WeightUnit}
            onOpen={() => router.push("/routines")}
            onClose={() => router.push("/routines")}
          />
        ) : (
          <WizardFrame
            sequence={sequence}
            step={screen as WizardStep}
            onClose={close}
            title={WIZARD_COPY[screen as WizardStep].title}
            hint={WIZARD_COPY[screen as WizardStep].hint}
            footer={renderFooter()}
          >
            {renderWizardBody()}
          </WizardFrame>
        )}
      </div>
    </div>
  );

  function renderWizardBody() {
    switch (screen) {
      case "focus":
        return (
          <ChipGrid options={FOCUS} selected={focus} onToggle={(v) => setFocus((s) => toggle(s, v))} />
        );
      case "equipment":
        return (
          <ChipGrid
            options={EQUIPMENT}
            selected={equipment}
            onToggle={(v) => setEquipment((s) => toggle(s, v))}
          />
        );
      case "experience":
        return (
          <div className="grid grid-cols-2 gap-2.5">
            {EXPERIENCE.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => {
                  setExperience(e);
                  setScreen("schedule");
                }}
                className={`rounded-2xl border px-4 py-4 text-sm font-semibold transition-colors ${
                  experience === e
                    ? "border-yellow bg-primary-dim text-primary"
                    : "bg-white/[0.04] text-muted-foreground hover:text-foreground"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        );
      case "schedule":
        return (
          <div className="space-y-7">
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-tertiary-foreground">
                Distinct workouts
              </div>
              <div className="flex flex-wrap gap-2.5">
                {[3, 4, 5, 6, 7, 8].map((n) => (
                  <Chip
                    key={n}
                    label={String(n)}
                    active={distinctWorkouts === n}
                    onClick={() => setDistinctWorkouts(n)}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-tertiary-foreground">
                Program length
              </div>
              <div className="flex flex-wrap gap-2.5">
                {[30, 60, 90, 120].map((n) => (
                  <Chip
                    key={n}
                    label={`${n} days`}
                    active={programLength === n}
                    onClick={() => setProgramLength(n)}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-tertiary-foreground">
                Structure notes{" "}
                <span className="tracking-normal text-tertiary-foreground/70 normal-case">
                  (optional)
                </span>
              </div>
              <textarea
                value={structureNotes}
                onChange={(e) => setStructureNotes(e.target.value)}
                rows={3}
                placeholder="e.g. Push / Pull / Legs, rest after every 3 days, extra arm work."
                maxLength={500}
                className="w-full resize-none rounded-xl border-strong bg-input px-4 py-3 text-sm outline-none placeholder:text-tertiary-foreground focus:border-yellow focus:bg-input-focus"
              />
            </div>
          </div>
        );
      case "extras":
        return (
          <div className="space-y-4">
            <ChipGrid options={EXTRA_PRESETS} selected={extras} onToggle={(v) => setExtras((s) => toggle(s, v))} />
            <div className="flex gap-2">
              <input
                value={extraCustom}
                onChange={(e) => setExtraCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && extraCustom.trim()) {
                    setExtras((s) => [...s, extraCustom.trim()]);
                    setExtraCustom("");
                  }
                }}
                placeholder="Add a custom goal…"
                maxLength={80}
                className="h-12 min-w-0 flex-1 rounded-xl border-strong bg-input px-4 text-sm outline-none placeholder:text-tertiary-foreground focus:border-yellow focus:bg-input-focus"
              />
              <button
                type="button"
                onClick={() => {
                  if (extraCustom.trim()) {
                    setExtras((s) => [...s, extraCustom.trim()]);
                    setExtraCustom("");
                  }
                }}
                aria-label="Add goal"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"
              >
                <Plus className="h-5 w-5" strokeWidth={2.4} />
              </button>
            </div>
          </div>
        );
      case "imbalances":
        return (
          <div className="space-y-4">
            <ChipGrid
              options={MUSCLE_AREAS}
              selected={imbalanceMuscles}
              onToggle={(v) => setImbalanceMuscles((s) => toggle(s, v))}
            />
            <textarea
              value={imbalanceNotes}
              onChange={(e) => setImbalanceNotes(e.target.value)}
              rows={3}
              placeholder="Anything specific? (e.g. weak left side, lagging glutes)"
              maxLength={400}
              className="w-full resize-none rounded-xl border-strong bg-input px-4 py-3 text-sm outline-none placeholder:text-tertiary-foreground focus:border-yellow focus:bg-input-focus"
            />
          </div>
        );
      case "injuries":
        return (
          <div className="space-y-4">
            <ChipGrid
              options={INJURY_AREAS}
              selected={injuryDetails}
              onToggle={(v) => setInjuryDetails((s) => toggle(s, v))}
            />
            <textarea
              value={injuryNotes}
              onChange={(e) => setInjuryNotes(e.target.value)}
              rows={3}
              placeholder="Specifics? (e.g. avoid heavy squats, no overhead pressing)"
              maxLength={400}
              className="w-full resize-none rounded-xl border-strong bg-input px-4 py-3 text-sm outline-none placeholder:text-tertiary-foreground focus:border-yellow focus:bg-input-focus"
            />
          </div>
        );
      case "summary":
        return (
          <div className="space-y-3.5">
            <div className="card-elevated divide-y divide-[color:var(--divider)] px-4">
              <SummaryRow label="Focus" value={focus.join(", ")} onEdit={() => setScreen("focus")} />
              <SummaryRow label="Equipment" value={equipment.join(", ")} onEdit={() => setScreen("equipment")} />
              <SummaryRow label="Experience" value={experience ?? "-"} onEdit={() => setScreen("experience")} />
              <SummaryRow
                label="Distinct workouts"
                value={`${distinctWorkouts} workouts`}
                onEdit={() => setScreen("schedule")}
                highlight
              />
              <SummaryRow
                label="Program length"
                value={`${programLength} days`}
                onEdit={() => setScreen("schedule")}
                highlight
              />
              {structureNotes.trim() ? (
                <SummaryRow
                  label="Structure notes"
                  value={structureNotes.trim()}
                  onEdit={() => setScreen("schedule")}
                  highlight
                />
              ) : null}
              <SummaryRow label="Extras" value={extras.join(", ") || "none"} onEdit={() => setScreen("extras")} />
              {extras.includes("Fix muscle imbalances") && (
                <SummaryRow
                  label="Imbalances"
                  value={imbalanceMuscles.join(", ") + (imbalanceNotes ? ` · ${imbalanceNotes}` : "")}
                  onEdit={() => setScreen("imbalances")}
                />
              )}
              {extras.includes("Train around injury") && (
                <SummaryRow
                  label="Injuries"
                  value={injuryDetails.join(", ") + (injuryNotes ? ` · ${injuryNotes}` : "")}
                  onEdit={() => setScreen("injuries")}
                />
              )}
            </div>
            <div className="flex items-start gap-2.5 px-0.5">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tertiary-foreground" />
              <p className="text-xs leading-relaxed text-tertiary-foreground">
                Your workouts rotate on a cycle Fit Bot designs from these; they repeat back to
                back rather than being pinned to weekdays.
              </p>
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  function renderFooter() {
    switch (screen) {
      case "focus":
        return <WizardFooter onNext={() => setScreen("equipment")} disabled={focus.length === 0} />;
      case "equipment":
        return (
          <WizardFooter
            onBack={() => setScreen("focus")}
            onNext={() => setScreen("experience")}
            disabled={equipment.length === 0}
          />
        );
      case "experience":
        return <WizardFooter onBack={() => setScreen("equipment")} />;
      case "schedule":
        return (
          <WizardFooter onBack={() => setScreen("experience")} onNext={() => setScreen("extras")} />
        );
      case "extras":
        return <WizardFooter onBack={() => setScreen("schedule")} onNext={() => handleNext("extras")} />;
      case "imbalances":
        return <WizardFooter onBack={() => setScreen("extras")} onNext={() => handleNext("imbalances")} />;
      case "injuries":
        return (
          <WizardFooter
            onBack={() =>
              setScreen(extras.includes("Fix muscle imbalances") ? "imbalances" : "extras")
            }
            onNext={() => handleNext("injuries")}
          />
        );
      case "summary":
        return (
          <div className="space-y-3">
            <button
              type="button"
              onClick={startBuild}
              disabled={!focus.length || !equipment.length || !experience}
              className={CTA}
            >
              <Sparkles className="h-[19px] w-[19px]" />
              Build my program
            </button>
            <button
              type="button"
              onClick={() => setScreen("focus")}
              className="mx-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Start over
            </button>
          </div>
        );
      default:
        return null;
    }
  }
}

const WIZARD_COPY: Record<WizardStep, { title: string; hint?: string }> = {
  focus: { title: "What's your training focus?", hint: "Pick one or more." },
  equipment: { title: "What equipment do you have?", hint: "Pick all that apply." },
  experience: { title: "What's your experience level?", hint: "Pick one." },
  schedule: {
    title: "How should your program rotate?",
    hint: "Pick how many distinct workouts to rotate through, how long it runs, and any structure notes.",
  },
  extras: { title: "Anything else?", hint: "Optional - pick any that apply." },
  imbalances: { title: "Which muscles need extra work?", hint: "Pick areas you want to bring up." },
  injuries: { title: "What should we work around?", hint: "So Fit Bot can pick safe alternatives." },
  summary: { title: "Ready to build your program?", hint: "Review and tweak." },
};

/* ------------------------------- chrome --------------------------------- */

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

function WizardFrame({
  sequence,
  step,
  title,
  hint,
  onClose,
  children,
  footer,
}: {
  sequence: WizardStep[];
  step: WizardStep;
  title: string;
  hint?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const idx = Math.max(0, sequence.indexOf(step));
  const total = sequence.length;
  return (
    <>
      <TopBar onClose={onClose} label="Fit Bot" />
      <div className="px-5 pt-1">
        <div className="mb-5 flex gap-1.5">
          {Array.from({ length: total }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i <= idx ? "bg-primary" : "bg-white/[0.12]"}`}
            />
          ))}
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-tertiary-foreground">
          Step {idx + 1} of {total}
        </div>
        <h1 className="mt-2.5 text-[26px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        {hint ? <p className="mt-1.5 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="flex-1 overflow-y-auto px-5 pt-6">{children}</div>
      <div className="px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">{footer}</div>
    </>
  );
}

function WizardFooter({
  onBack,
  onNext,
  disabled,
  label = "Next",
}: {
  onBack?: () => void;
  onNext?: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="flex h-12 items-center gap-1.5 px-3 font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : (
        <div />
      )}
      {onNext ? (
        <button
          type="button"
          onClick={onNext}
          disabled={disabled}
          className="flex h-[52px] items-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] px-7 font-bold text-primary-foreground shadow-cta disabled:opacity-50"
        >
          {label}
          <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2.5 text-sm transition-colors ${
        active
          ? "bg-primary font-semibold text-primary-foreground"
          : "border bg-white/[0.04] font-medium text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
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
    <div className="flex flex-wrap gap-2.5">
      {options.map((o) => (
        <Chip key={o} label={o} active={selected.includes(o)} onClick={() => onToggle(o)} />
      ))}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onEdit,
  highlight,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 py-3 ${
        highlight ? "-mx-4 bg-primary/5 px-4" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-tertiary-foreground">
          {label}
        </div>
        <div className="mt-1 text-sm">{value || "-"}</div>
      </div>
      {onEdit ? (
        <button type="button" onClick={onEdit} className="text-xs font-semibold text-primary hover:underline">
          Edit
        </button>
      ) : null}
    </div>
  );
}

/* ---------------------------- building (9b/9c) -------------------------- */

function BuildingScreen({
  structureStatus,
  structureError,
  phases,
  finalizing,
  finalizeError,
  onCancel,
  onRetryStructure,
  onRetryPhase,
  onRetrySave,
}: {
  structureStatus: StepStatus;
  structureError: string | null;
  phases: PhaseState[];
  finalizing: boolean;
  finalizeError: string | null;
  onCancel: () => void;
  onRetryStructure: () => void;
  onRetryPhase: (i: number) => void;
  onRetrySave: () => void;
}) {
  const totalSteps = 1 + phases.length;
  const doneSteps =
    (structureStatus === "done" ? 1 : 0) + phases.filter((p) => p.status === "done").length;
  const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const anyFailed =
    structureStatus === "failed" || phases.some((p) => p.status === "failed") || !!finalizeError;

  return (
    <div className="flex flex-1 flex-col px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-11">
      <div className="pt-4 pb-1 text-center">
        <div className="mb-4 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
          <Sparkles className="h-3.5 w-3.5" /> Fit Bot
        </div>
        <h2 className="text-2xl font-bold">
          {anyFailed ? "One step needs a retry" : "Building your program"}
        </h2>
        <p className="mx-auto mt-2 max-w-[280px] text-sm leading-relaxed text-muted-foreground">
          {anyFailed
            ? "The rest of your program is safe - just rebuild the flagged step."
            : "Built in segments so nothing times out. A minute or two - keep this screen open."}
        </p>
      </div>

      <div className="mt-5 mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-tertiary-foreground">
          Progress
        </span>
        <span className="font-mono text-xs font-bold text-primary">
          {doneSteps} / {totalSteps}
        </span>
      </div>
      <div className="mb-6 h-2 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#E5FF00,#c9e000)] shadow-[0_0_12px_rgba(229,255,0,0.5)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <ChecklistRow
          title="Structure & phases"
          sub="Split · progression plan"
          status={structureStatus}
          error={structureError ?? undefined}
          onRetry={onRetryStructure}
        />
        {phases.map((p, i) => (
          <ChecklistRow
            key={i}
            title={p.name}
            sub={`Weeks ${p.startWeek}–${p.endWeek}`}
            status={p.status}
            error={p.error}
            onRetry={() => onRetryPhase(i)}
          />
        ))}
      </div>

      {finalizing ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />
          Saving to your Routines…
        </p>
      ) : null}

      {finalizeError ? (
        <div className="mt-4 rounded-2xl border-[1.5px] border-[#E8544E]/50 bg-[#E8544E]/[0.07] p-4">
          <p className="text-sm text-[#E8544E]">{finalizeError}</p>
          <button
            type="button"
            onClick={onRetrySave}
            className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground"
          >
            <RotateCw className="h-4 w-4" /> Retry save
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onCancel}
        className="mt-auto h-12 w-full rounded-2xl border-strong bg-transparent font-semibold text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  );
}

function ChecklistRow({
  title,
  sub,
  status,
  error,
  onRetry,
}: {
  title: string;
  sub: string;
  status: StepStatus;
  error?: string;
  onRetry: () => void;
}) {
  if (status === "failed") {
    return (
      <div className="rounded-2xl border-[1.5px] border-[#E8544E]/50 bg-[#E8544E]/[0.07] px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E8544E]/20 text-[#E8544E]">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-0.5 font-mono text-[11px] text-[#E8544E]">{sub} · couldn&apos;t build</div>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-[13px] font-bold text-primary-foreground"
          >
            <RotateCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
        {error ? <div className="mt-2 pl-10 text-[11px] text-muted-foreground">{error}</div> : null}
      </div>
    );
  }

  const building = status === "building";
  const done = status === "done";
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${
        building
          ? "border-[1.5px] border-yellow bg-primary-dim"
          : done
            ? "border bg-[#141412]"
            : "border bg-[#111110] opacity-55"
      }`}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center">
        {done ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
            <Check className="h-4 w-4 text-primary-foreground" strokeWidth={3.5} />
          </span>
        ) : building ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : (
          <span className="h-7 w-7 rounded-full border-[1.5px] border-white/20" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${done || building ? "" : "text-muted-foreground"}`}>
          {title}
        </div>
        <div className={`mt-0.5 font-mono text-[11px] ${building ? "text-primary" : "text-tertiary-foreground"}`}>
          {sub}
          {building ? " · building…" : status === "queued" ? " · queued" : ""}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- program ready (9d) ------------------------ */

/**
 * The program, in full, before anything is written.
 *
 * Ivo built one end to end on 2026-09-22 and this screen is his verdict: "when
 * the routine was finished, there was nowhere to actually see all of the
 * exercises... I felt a little bit like I had to accept the routine and hope
 * that I could then go into the individual routine tab and change it there."
 *
 * So: every day with its exercises on one side, a conversation with FitBot on
 * the other, and a save button that is the only thing that writes. Desktop puts
 * them side by side; mobile stacks the chat under the program, because the
 * program is the thing being judged and it should be what you land on.
 */
function ReviewScreen({
  program,
  weightUnit,
  turns,
  refining,
  error,
  saving,
  saveError,
  onRefine,
  onSave,
  onClose,
}: {
  program: Program;
  weightUnit: WeightUnit;
  turns: { role: "user" | "fitbot"; text: string }[];
  refining: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  onRefine: (instruction: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  // One rotation is the whole shape of the program; the loads climb from here
  // week by week, which the line below says rather than repeating 60 days.
  const cycle = program.days.slice(0, program.cycleLength);
  const training = cycle.filter((d) => !d.isRest);

  function send() {
    const text = input.trim();
    if (!text || refining) return;
    setInput("");
    onRefine(text);
  }

  return (
    <>
      <TopBar onClose={onClose} label="Built by FitBot" backIcon right="Not saved yet" />
      <div className="flex-1 overflow-y-auto px-5 pb-28">
        <div className="mt-2">
          <h1 className="text-[25px] font-bold leading-tight tracking-[-0.02em]">{program.name}</h1>
          <div className="mt-1.5 font-mono text-xs tracking-[0.06em] text-muted-foreground">
            {training.length} WORKOUTS · {program.cycleLength}-DAY CYCLE · {program.days.length} DAYS
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            This is one rotation. It repeats for the whole program, and the working
            weights climb each week. Nothing is saved until you say so - tell FitBot
            what to change first.
          </p>
        </div>

        <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
          <div className="min-w-0">
            <ProgramDayList days={cycle} weightUnit={weightUnit} />
          </div>

          <div className="mt-5 lg:mt-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-tertiary-foreground">
              Change anything
            </div>
            <div className="mt-2 space-y-2" data-testid="refine-transcript">
              {turns.length === 0 && (
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Ask in your own words. &quot;Swap the barbell squat, my knee hates
                  it.&quot; &quot;Day 3 is too long.&quot; &quot;More upper body pulling.&quot;
                  &quot;I have an L5-S1 disc herniation, work around it.&quot;
                </p>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  data-testid={`refine-turn-${i}`}
                  className={
                    t.role === "user"
                      ? "rounded-2xl rounded-br-md bg-primary-dim px-3.5 py-2.5 text-[13px] text-foreground"
                      : "rounded-2xl rounded-bl-md border bg-white/[0.02] px-3.5 py-2.5 text-[13px] text-muted-foreground"
                  }
                >
                  {t.text}
                </div>
              ))}
              {refining && (
                <div className="rounded-2xl rounded-bl-md border bg-white/[0.02] px-3.5 py-2.5 text-[13px] text-muted-foreground">
                  Rewriting the program...
                </div>
              )}
              {error && (
                <div className="rounded-xl border-[1.5px] border-yellow bg-primary-dim px-3.5 py-2.5 text-[13px] text-foreground">
                  {error}
                </div>
              )}
            </div>

            <div className="mt-3 flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder="Tell FitBot what to change"
                data-testid="input-refine-program"
                className="min-w-0 flex-1 resize-none rounded-xl border-strong bg-input px-4 py-3 text-sm outline-none placeholder:text-tertiary-foreground focus:border-yellow focus:bg-input-focus"
              />
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || refining}
                data-testid="button-send-refine"
                className="h-[46px] shrink-0 self-end rounded-xl border-strong bg-white/[0.04] px-4 text-sm font-semibold text-foreground disabled:text-tertiary-foreground"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Saving is the only thing that writes, so it is the only primary action. */}
      <div className="sticky bottom-0 border-t border-divider bg-background/95 px-5 py-3 backdrop-blur-sm">
        {saveError && (
          <p className="mb-2 text-[13px] text-foreground" data-testid="text-save-error">
            {saveError}
          </p>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || refining}
          data-testid="button-save-program"
          className="flex h-[52px] w-full items-center justify-center rounded-2xl bg-primary text-[15px] font-bold text-primary-foreground shadow-cta disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save to my routines"}
        </button>
      </div>
    </>
  );
}

function PreviewScreen({
  result,
  weightUnit,
  onOpen,
  onClose,
}: {
  weightUnit: WeightUnit;
  result: {
    name: string;
    cycleLength: number;
    distinctWorkouts: number | null;
    weeksGenerated: number;
    daysGenerated: number;
    program: Program;
  };
  onOpen: () => void;
  onClose: () => void;
}) {
  // Show one full rotation of the cycle (the pattern then repeats for the whole
  // program). Rest days are included so the rotation reads clearly.
  const cycleLength = result.program.cycleLength;
  const shown = result.program.days.slice(0, cycleLength);
  const distinctCount =
    result.distinctWorkouts ??
    new Set(shown.filter((d) => !d.isRest).map((d) => d.workoutName)).size;

  return (
    <>
      <TopBar onClose={onClose} label="Built by FitBot" backIcon right="Built by FitBot" />
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="mt-2 space-y-4">
          <div>
            <h1 className="text-[25px] font-bold leading-tight tracking-[-0.02em]">{result.name}</h1>
            <div className="mt-1.5 font-mono text-xs tracking-[0.06em] text-muted-foreground">
              {distinctCount} WORKOUTS · {cycleLength}-DAY CYCLE · {result.daysGenerated} SESSIONS
            </div>
          </div>

          <div className="flex gap-3 rounded-2xl border-[1.5px] border-yellow bg-primary-dim p-4">
            <Sparkles className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
            <p className="text-[13px] leading-relaxed text-foreground/85">
              Saved to your Routines. Your workouts rotate on this {cycleLength}-day cycle with
              progressive overload built in across all {result.weeksGenerated} weeks. Open it to
              edit any day or start now.
            </p>
          </div>

          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-tertiary-foreground">
            Your rotation
          </div>
          <ProgramDayList days={shown} weightUnit={weightUnit} />
        </div>
      </div>

      <div className="bg-gradient-to-t from-background via-background to-transparent px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
        <button type="button" onClick={onOpen} className={CTA}>
          Open in Routines
        </button>
      </div>
    </>
  );
}
