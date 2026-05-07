"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Step = 1 | 2 | 3;

const DAYS_OPTIONS = [2, 3, 4, 5, 6] as const;
const LENGTH_OPTIONS = [30, 60, 90, 120] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [daysPerWeek, setDaysPerWeek] = useState<number | null>(null);
  const [programLength, setProgramLength] = useState<number | null>(null);

  const finish = useMutation({
    mutationFn: async (vars: {
      hasCompletedOnboarding: true;
      onboardingDaysPerWeek?: number | null;
      onboardingProgramLength?: number | null;
    }) => {
      const res = await apiRequest("PATCH", "/api/user-settings", vars);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
    },
  });

  async function handleSkip() {
    await finish.mutateAsync({ hasCompletedOnboarding: true });
    window.location.href = "/";
  }

  async function handlePickDays(d: number) {
    setDaysPerWeek(d);
    setStep(2);
  }

  async function handlePickLength(n: number) {
    setProgramLength(n);
    setStep(3);
  }

  async function handleManualSetup() {
    await finish.mutateAsync({
      hasCompletedOnboarding: true,
      onboardingDaysPerWeek: daysPerWeek,
      onboardingProgramLength: programLength,
    });
    window.location.href = "/";
  }

  async function handleFitBot() {
    await finish.mutateAsync({
      hasCompletedOnboarding: true,
      onboardingDaysPerWeek: daysPerWeek,
      onboardingProgramLength: programLength,
    });
    // Fit Bot builder lives at /routines for now (Phase 6 #7 will add a dedicated flow)
    window.location.href = "/routines";
  }

  return (
    <main className="flex min-h-screen flex-col p-5 sm:p-8">
      {/* Skip — always available */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSkip}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Skip for now
          <X className="inline-block ml-1 h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-center max-w-md w-full mx-auto py-8 space-y-8">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1.5 rounded-full transition-all ${
                n === step
                  ? "w-8 bg-primary"
                  : n < step
                    ? "w-4 bg-primary/50"
                    : "w-4 bg-muted"
              }`}
            />
          ))}
        </div>

        {step === 1 ? (
          <div className="space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-bold">How often do you want to train?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Tap to continue
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {DAYS_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => handlePickDays(d)}
                  className="aspect-square rounded-xl border border-border bg-card hover:border-primary hover:bg-primary/5 flex flex-col items-center justify-center transition-colors"
                  data-testid={`option-days-${d}`}
                >
                  <span className="text-3xl font-bold">{d}</span>
                  <span className="text-xs text-muted-foreground mt-1">days/wk</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-bold">How long is your next program?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Tap to continue
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {LENGTH_OPTIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => handlePickLength(n)}
                  className="rounded-xl border border-border bg-card hover:border-primary hover:bg-primary/5 px-6 py-8 flex flex-col items-center justify-center transition-colors"
                  data-testid={`option-length-${n}`}
                >
                  <span className="text-3xl font-bold">{n}</span>
                  <span className="text-xs text-muted-foreground mt-1">days</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </button>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-6 text-center">
            <div>
              <h1 className="text-3xl font-bold">Want to build a personalized program with AI?</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Fit Bot can put together a {programLength}-day plan tailored to your goals.
              </p>
            </div>
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 space-y-3 text-left">
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-5 w-5" />
                <span className="font-semibold">Meet Fit Bot</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Answer a few questions about your training focus, equipment, and goals, and Fit Bot
                will draft a routine you can review and tweak.
              </p>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleFitBot}
                disabled={finish.isPending}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Build My Program with Fit Bot
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleManualSetup}
                disabled={finish.isPending}
                className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-border text-sm hover:bg-secondary disabled:opacity-50"
              >
                I&rsquo;ll set up my routine manually
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
