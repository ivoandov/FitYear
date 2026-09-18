"use client";

import { useState } from "react";
import { ChevronDown, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { Exercise } from "@/data/exercises";
import {
  DEFAULT_PROGRESSION,
  describeRule,
  normalizeRule,
  type MaybeRule,
  type ProgressionRule,
} from "@/lib/progression";
import { usesWeight } from "@/lib/exercise-types";
import { displayToLbs, lbsToDisplay, type WeightUnit } from "@/lib/units";

/**
 * Starting weights, and each exercise's own progression rule, for one routine
 * day in the hand-built routine editor.
 *
 * Progressive overload climbs from `targetLoadLbs`. FitBot programs carry one
 * per exercise and a hand-built routine had no way to set it, so a manual
 * routine could hold a "+5 lb a week" rule with nothing to climb from (Ivo,
 * 2026-09-18). Both fields are written onto the exercise object inside the
 * routine entry, which the routine PUT stores verbatim - no schema change.
 *
 * The rule is a CHOICE between the routine's rule and the exercise's own,
 * never two half-fields, because that is how `effectiveRule` resolves it: an
 * exercise's rule replaces the routine default whole rather than merging with
 * it, so a half-inherited scheme is not something the backend can express.
 */

type Props = {
  dayIndex: number;
  exercises: Exercise[];
  weightUnit: WeightUnit;
  /** The routine's default rule as currently set in the editor, or null when off. */
  routineRule: ProgressionRule | null;
  /** Read from the catalog, which is authoritative for both. */
  exerciseTypeOf: (ex: Exercise) => string | null | undefined;
  isAssisted: (ex: Exercise) => boolean;
  onChange: (exIndex: number, next: Exercise) => void;
};

/** A cleared field is unset, not zero, so it renders empty rather than "0". */
function numberOrUnset(text: string): number | undefined {
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : undefined;
}

function startingLbs(ex: Exercise): number | null {
  const n = Number(ex.targetLoadLbs);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function RoutineDayWeights({
  dayIndex,
  exercises,
  weightUnit,
  routineRule,
  exerciseTypeOf,
  isAssisted,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);

  // Only exercises that carry a load can have a starting weight. A timed row or
  // a run has nothing to climb.
  const weighted = exercises
    .map((ex, index) => ({ ex, index }))
    .filter(({ ex }) => usesWeight(exerciseTypeOf(ex)));
  if (weighted.length === 0) return null;
  const setCount = weighted.filter(({ ex }) => startingLbs(ex) != null).length;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
        data-testid={`button-toggle-weights-${dayIndex}`}
      >
        <TrendingUp className="h-3 w-3" />
        Starting weights
        <span className={setCount > 0 ? "text-primary" : "text-tertiary-foreground"}>
          {setCount}/{weighted.length}
        </span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="space-y-1.5 pb-1">
          {weighted.map(({ ex, index }) => (
            <ExerciseWeightRow
              key={`${index}-${weightUnit}`}
              testKey={`${dayIndex}-${index}`}
              exercise={ex}
              weightUnit={weightUnit}
              routineRule={routineRule}
              assisted={isAssisted(ex)}
              onChange={(next) => onChange(index, next)}
            />
          ))}
          <p className="pt-0.5 text-[11px] leading-snug text-tertiary-foreground">
            The first session starts at this weight. Leave it empty and nothing
            climbs.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ExerciseWeightRow({
  testKey,
  exercise,
  weightUnit,
  routineRule,
  assisted,
  onChange,
}: {
  testKey: string;
  exercise: Exercise;
  weightUnit: WeightUnit;
  routineRule: ProgressionRule | null;
  assisted: boolean;
  onChange: (next: Exercise) => void;
}) {
  const start = startingLbs(exercise);
  // The row keeps the TYPED text rather than re-deriving it from the stored
  // pounds on every keystroke: a kg value round-trips through a conversion, and
  // re-rendering "60." as "60" would make a decimal impossible to type. Keyed
  // on the unit by the parent, so a settings load remounts it in the right one.
  const [draft, setDraft] = useState(() => {
    const shown = lbsToDisplay(start, weightUnit);
    return shown == null ? "" : String(shown);
  });

  const ownRule = normalizeRule(exercise.progression as MaybeRule);
  const hasOwn = exercise.progression != null;

  const setStart = (text: string) => {
    setDraft(text);
    const n = parseFloat(text);
    const next = { ...exercise };
    if (Number.isFinite(n) && n > 0) next.targetLoadLbs = displayToLbs(n, weightUnit);
    else delete next.targetLoadLbs;
    onChange(next);
  };

  const setOwn = (rule: { incrementLbs?: number; everyWeeks?: number } | null) => {
    const next = { ...exercise };
    if (rule) next.progression = rule;
    else delete next.progression;
    onChange(next);
  };

  // Seed an own rule from what the routine does now, so choosing it starts from
  // a sensible place rather than from nothing. With no routine rule, 5 lb or
  // 2.5 kg - the same first step the routine-level control offers.
  const seed =
    routineRule ?? (weightUnit === "kg" ? { incrementLbs: displayToLbs(2.5, "kg") ?? 5.5, everyWeeks: 1 } : DEFAULT_PROGRESSION);
  const raw = (exercise.progression ?? {}) as { incrementLbs?: number; everyWeeks?: number };
  const unitLabel = weightUnit === "kg" ? "kg" : "lb";
  // The increment is typed in the viewer's unit and stored in pounds, so it
  // keeps its own draft text for the same reason the starting weight does.
  const shownIncrement = (lbs: number | undefined) => {
    const v = lbsToDisplay(lbs ?? null, weightUnit);
    return v == null ? "" : String(v);
  };
  const [incrementDraft, setIncrementDraft] = useState(() => shownIncrement(raw.incrementLbs));

  return (
    <div
      className="rounded-lg border bg-white/[0.02] px-2.5 py-2"
      data-testid={`row-start-weight-${testKey}`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{exercise.name}</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={weightUnit === "kg" ? 0.5 : 2.5}
          value={draft}
          onChange={(e) => setStart(e.target.value)}
          placeholder="Start"
          className="h-9 w-20 text-right"
          aria-label={`Starting weight for ${exercise.name}`}
          data-testid={`input-start-weight-${testKey}`}
        />
        <span className="w-6 font-mono text-[11px] text-tertiary-foreground">{weightUnit === "kg" ? "kg" : "lb"}</span>
      </div>

      {start == null ? null : assisted ? (
        <p className="mt-1.5 text-[11px] leading-snug text-tertiary-foreground">
          Assisted lift, so it stays at this weight. Adding to it would make it easier.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border bg-white/[0.03] p-0.5" role="group" aria-label="Progression rule">
              {[
                { own: false, label: "Routine rule" },
                { own: true, label: "Own rule" },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  aria-pressed={hasOwn === opt.own}
                  onClick={() => {
                    // Re-choosing the current option must not reset a rule
                    // somebody has already typed.
                    if (hasOwn === opt.own) return;
                    if (opt.own) setIncrementDraft(shownIncrement(seed.incrementLbs));
                    setOwn(opt.own ? { incrementLbs: seed.incrementLbs, everyWeeks: seed.everyWeeks } : null);
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                    hasOwn === opt.own
                      ? "bg-white/[0.08] text-foreground"
                      : "text-tertiary-foreground hover:text-foreground"
                  }`}
                  data-testid={`button-rule-${opt.own ? "own" : "routine"}-${testKey}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {!hasOwn ? (
              <span className="text-[11px] text-muted-foreground" data-testid={`text-rule-${testKey}`}>
                {routineRule ? describeRule(routineRule, weightUnit) : "Stays at this weight"}
              </span>
            ) : null}
          </div>

          {hasOwn ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
              <span>+</span>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={incrementDraft}
                onChange={(e) => {
                  setIncrementDraft(e.target.value);
                  const n = numberOrUnset(e.target.value);
                  setOwn({
                    incrementLbs: n == null ? undefined : (displayToLbs(n, weightUnit) ?? undefined),
                    everyWeeks: raw.everyWeeks,
                  });
                }}
                className="h-8 w-16"
                aria-label={`${weightUnit === "kg" ? "Kilograms" : "Pounds"} to add for ${exercise.name}`}
                data-testid={`input-own-increment-${testKey}`}
              />
              <span>{unitLabel} every</span>
              <Input
                type="number"
                min={1}
                step={1}
                value={raw.everyWeeks ?? ""}
                onChange={(e) => setOwn({ incrementLbs: raw.incrementLbs, everyWeeks: numberOrUnset(e.target.value) })}
                className="h-8 w-14"
                aria-label={`Weeks between increases for ${exercise.name}`}
                data-testid={`input-own-weeks-${testKey}`}
              />
              <span>{raw.everyWeeks === 1 ? "week" : "weeks"}</span>
              {!ownRule ? (
                <span className="basis-full text-[11px] text-destructive">
                  Enter an amount above 0, or switch back to the routine rule.
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
