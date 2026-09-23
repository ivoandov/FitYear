"use client";

import { useState } from "react";
import { ArrowLeft, ClipboardList, Dumbbell, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { MAX_NOTE_LENGTH } from "@/lib/coach-notes";
import {
  DESTINATION,
  FLOW,
  buildCoachNotes,
  monthlyGoalFromDaysPerWeek,
  type Door,
  type StepKey,
} from "@/lib/onboarding";

/**
 * The first thing anybody sees, and the one screen that decides what FitYear is
 * for them.
 *
 * The old flow asked everyone how long their next PROGRAM would be, before they
 * had seen a single screen, and then offered the coach-or-manual choice last.
 * Both questions only make sense on one branch, so everybody who wanted to log
 * a bench press answered two questions about a thing they did not want.
 *
 * So the fork comes FIRST. Ivo's framing, 2026-09-17: "an app where you can
 * mundanely track your workouts if you want or where you can have a
 * personalized fitness coach guide you through the journey if you want, and
 * anything in between." The three doors are that sentence, and choosing one is
 * also the orientation - which is why there is no tour. A tour is the screen
 * everybody skips.
 *
 * The coached branch asks only what FitBot can NEVER read for itself. It can
 * already see every set, weight, rep, record, routine and measurement, so
 * asking about any of that would waste the one moment of attention we get and
 * be answered worse than the data answers it. What it cannot derive is what
 * somebody is training FOR, what they have to train WITH, and what to train
 * AROUND. Those three answers are written straight into `coach_notes`, so the
 * coach knows them before the first message rather than interrogating the user
 * later.
 */

const CARD = "card-elevated p-[18px]";
const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.14em] text-tertiary-foreground";

const DOORS: { key: Door; title: string; blurb: string; icon: typeof Dumbbell }[] = [
  {
    key: "track",
    title: "Just let me log my workouts",
    blurb: "Straight to tracking. No setup, no program, no questions.",
    icon: Dumbbell,
  },
  {
    key: "coach",
    title: "Coach me through it",
    blurb: "A few quick questions, then FitBot builds you a real program.",
    icon: Sparkles,
  },
  {
    key: "import",
    title: "I already have a program",
    blurb: "Paste it in and FitYear turns it into something you can track.",
    icon: ClipboardList,
  },
];

export default function OnboardingPage() {
  const [door, setDoor] = useState<Door | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const [unit, setUnit] = useState<"lbs" | "kg">("lbs");
  const [days, setDays] = useState<number | null>(null);
  const [anythingText, setAnythingText] = useState("");

  const steps: StepKey[] = door ? FLOW[door] : [];
  const step = steps[stepIndex];

  /**
   * Finish, and never let a coach note be the reason it fails.
   *
   * The settings PATCH is what actually ends onboarding - it sets
   * `hasCompletedOnboarding`, which writes the `fy_onboarded` cookie the proxy
   * gates on. The notes are valuable but secondary: a user stuck on this screen
   * because a note POST 500'd would be a far worse outcome than a coach that
   * has to ask one question later.
   */
  async function finish(chosen: Door, opts?: { skipped?: boolean }) {
    if (saving) return;
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/user-settings", {
        hasCompletedOnboarding: true,
        weightUnit: unit,
        ...(days != null
          ? {
              onboardingDaysPerWeek: days,
              // Derived, not asked. Asking the same intention twice in
              // different units is how a setup form loses people.
              monthlyWorkoutGoal: monthlyGoalFromDaysPerWeek(days),
            }
          : {}),
      });

      if (!opts?.skipped) {
        const notes = buildCoachNotes({ anythingText });
        await Promise.allSettled(
          notes.map((n) => apiRequest("POST", "/api/coach-notes", n)),
        );
      }

      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
      // Full navigation, not router.push: this follows a write that the proxy
      // reads as a cookie on the next request.
      window.location.href = DESTINATION[chosen];
    } catch {
      setSaving(false);
    }
  }

  function advance() {
    if (!door) return;
    if (stepIndex + 1 >= steps.length) void finish(door);
    else setStepIndex((i) => i + 1);
  }

  function back() {
    if (stepIndex === 0) {
      setDoor(null);
      return;
    }
    setStepIndex((i) => i - 1);
  }


  return (
    <main className="flex min-h-screen flex-col p-5 sm:p-8">
      <div className="flex items-center justify-between">
        {door ? (
          <button
            type="button"
            onClick={back}
            data-testid="button-onboarding-back"
            className="flex items-center gap-1 text-sm text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => void finish(door ?? "track", { skipped: true })}
          disabled={saving}
          data-testid="button-skip-onboarding"
          className="text-sm text-muted-foreground disabled:opacity-40"
        >
          Skip for now
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 py-8">
        {!door ? (
          <>
            <div>
              <div className={`${EYEBROW} mb-2`}>Welcome to FitYear</div>
              <h1 className="text-3xl font-bold tracking-[-0.02em] text-foreground">
                What brings you here?
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                You can change your mind later. Nothing here locks you in.
              </p>
            </div>
            <div className="space-y-3">
              {DOORS.map(({ key, title, blurb, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setDoor(key);
                    setStepIndex(0);
                  }}
                  data-testid={`option-door-${key}`}
                  className={`${CARD} flex w-full items-center gap-4 text-left`}
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-dim">
                    <Icon className="h-5 w-5 text-primary" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-foreground">
                      {title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === "unit" ? (
          <>
            <div>
              <div className={`${EYEBROW} mb-2`}>Step {stepIndex + 1} of {steps.length}</div>
              <h1 className="text-3xl font-bold tracking-[-0.02em] text-foreground">
                Pounds or kilos?
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                How weights are shown everywhere in the app.
              </p>
            </div>
            <div className="flex gap-3">
              {(["lbs", "kg"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  data-testid={`option-unit-${u}`}
                  aria-pressed={unit === u}
                  className={`flex-1 rounded-2xl py-6 font-mono text-lg uppercase tracking-[0.1em] transition-colors ${
                    unit === u
                      ? "bg-primary font-bold text-primary-foreground shadow-cta"
                      : "border-strong bg-white/[0.03] text-muted-foreground"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
            <PrimaryButton onClick={advance} disabled={saving} testId="button-onboarding-next">
              {stepIndex + 1 >= steps.length ? "Start training" : "Continue"}
            </PrimaryButton>
          </>
        ) : null}

        {step === "days" ? (
          <>
            <div>
              <div className={`${EYEBROW} mb-2`}>Step {stepIndex + 1} of {steps.length}</div>
              <h1 className="text-3xl font-bold tracking-[-0.02em] text-foreground">
                How many days a week can you train?
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Be realistic rather than ambitious. FitBot plans around this.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  data-testid={`option-days-${d}`}
                  aria-pressed={days === d}
                  className={`aspect-square rounded-2xl transition-colors ${
                    days === d
                      ? "bg-primary text-primary-foreground shadow-cta"
                      : "border-strong bg-white/[0.03]"
                  }`}
                >
                  <span className="block text-2xl font-bold">{d}</span>
                  <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.08em] opacity-70">
                    days
                  </span>
                </button>
              ))}
            </div>
            <PrimaryButton onClick={advance} disabled={days == null} testId="button-onboarding-next">
              Continue
            </PrimaryButton>
          </>
        ) : null}

        {step === "anything" ? (
          <>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-tertiary-foreground">
              Step {stepIndex + 1} of {steps.length}
            </div>
            <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.01em]">
              Tell FitBot about you
            </h1>
            {/* An open question, asked like one. The flow used to put an
                optional "Add notes" box under a chip grid, which nobody reads
                as an invitation to say what actually matters - Ivo, running it:
                "it didn't feel like that was the right invocation or place to
                invite the user to truly share what's on their mind". What is
                typed here is stored verbatim as a memory, so it is the one
                moment where somebody's own words survive exactly. */}
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              What you are training for, what you train with, anything that hurts
              or that you work around, how you like to train. As much or as little
              as you want - FitBot remembers it and plans around it.
            </p>
            <textarea
              value={anythingText}
              onChange={(e) => setAnythingText(e.target.value)}
              rows={7}
              maxLength={MAX_NOTE_LENGTH}
              placeholder="Training for a muscle-up this year. Left shoulder gives me trouble overhead. Full gym, but only 45 minutes at lunch."
              data-testid="input-anything-text"
              className="mt-4 w-full resize-none rounded-2xl border-strong bg-input px-4 py-3.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-tertiary-foreground focus:border-yellow focus:bg-input-focus"
            />
            <p className="mt-2 text-right font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
              {anythingText.length} / {MAX_NOTE_LENGTH}
            </p>
            <PrimaryButton onClick={advance} testId="button-onboarding-next">
              {anythingText.trim() ? "Finish" : "Nothing to add"}
            </PrimaryButton>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              You can tell FitBot anything later, in the chat or in Settings.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
  testId,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="h-12 w-full rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] font-bold text-primary-foreground shadow-cta disabled:opacity-40"
    >
      {children}
    </button>
  );
}
