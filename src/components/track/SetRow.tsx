"use client";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Minus, Plus } from "lucide-react";
import { LB_PER_KG, type WeightUnit } from "@/lib/units";
import type { SetData } from "@/lib/workout-stats";

type Field = "weight" | "reps" | "distance" | "time";

interface SetRowProps {
  set: SetData;
  isDistanceTime: boolean;
  isCurrentSet: boolean;
  isActive: boolean;
  isPR: boolean;
  weightUnit: WeightUnit;
  weightIncrement: number;
  showKgConversion: boolean;
  // Progressive-overload ghost target (already unit-formatted, e.g. "target
  // 155 × 8"). Shown under the weight pill on the untouched prefilled current
  // set only; TrackPage clears it the moment the row is edited.
  ghostTarget?: string;
  onFieldChange: (field: Field, value: number | null) => void;
  onToggleComplete: (checked: boolean) => void;
}

// Shared grid template — header row (in TrackPage) MUST match this exactly.
const GRID =
  "grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_40px] gap-x-2.5";
// A borderless mono value that fills the stepper pill; native number spinners hidden.
const FIELD_INPUT =
  "h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-center font-mono text-[15px] font-semibold text-foreground focus-visible:border-0 focus-visible:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const STEPPER_MINUS =
  "flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground";
const STEPPER_PLUS =
  "flex h-full w-8 shrink-0 items-center justify-center text-primary transition-colors hover:text-primary/80";
const PILL =
  "flex h-10 items-center overflow-hidden rounded-[10px] border bg-input";

/**
 * A single tracked set row. Presentational: all state lives in TrackPage, which
 * passes the row's flags + field/complete callbacks. Renders the distance/time
 * columns for cardio exercises, else the weight / reps columns as `− value +`
 * stepper pills (with an optional lb hint in kg mode + PR badge). The current
 * set is highlighted (neon border + faint neon wash); completed sets show a
 * neon-filled check. testIds preserved.
 */
export function SetRow({
  set,
  isDistanceTime,
  isCurrentSet,
  isActive,
  isPR,
  weightUnit,
  weightIncrement,
  showKgConversion,
  ghostTarget,
  onFieldChange,
  onToggleComplete,
}: SetRowProps) {
  const isHighlighted = isCurrentSet || isActive;
  const rowClass = `${GRID} items-start rounded-xl border-[1.5px] px-2 py-2.5 transition-colors ${
    isHighlighted
      ? "border-yellow bg-primary/[0.06]"
      : isPR
        ? "border-transparent bg-primary-dim"
        : "border-transparent"
  }`;

  const setNumberCell = (
    <div
      className={`flex items-center gap-1 pt-2 font-mono text-sm font-bold ${
        isHighlighted ? "text-primary" : "text-tertiary-foreground"
      }`}
    >
      {set.setNumber}
      {isPR ? (
        <span
          className="rounded bg-primary/20 px-1 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-primary"
          data-testid={`pr-badge-${set.setNumber}`}
        >
          PR
        </span>
      ) : null}
    </div>
  );

  const doneCheckbox = (
    <div className="flex justify-center pt-1.5">
      <Checkbox
        checked={set.completed}
        onCheckedChange={(checked) => onToggleComplete(!!checked)}
        data-testid={`checkbox-complete-${set.setNumber}`}
        aria-label={`Complete set ${set.setNumber}`}
        className="size-7 rounded-[8px] border-strong data-checked:border-primary data-checked:bg-primary"
      />
    </div>
  );

  if (isDistanceTime) {
    return (
      <div className={rowClass} data-testid={`row-set-${set.setNumber}`}>
        {setNumberCell}
        <div className={PILL}>
          <Input
            type="number"
            step="0.1"
            value={set.distance ?? ""}
            onChange={(e) => onFieldChange("distance", e.target.value === "" ? null : parseFloat(e.target.value))}
            className={`${FIELD_INPUT} px-3`}
            data-testid={`input-distance-${set.setNumber}`}
          />
        </div>
        <div className={PILL}>
          <Input
            type="number"
            value={set.time ?? ""}
            onChange={(e) => onFieldChange("time", e.target.value === "" ? null : parseInt(e.target.value))}
            className={`${FIELD_INPUT} px-3`}
            data-testid={`input-time-${set.setNumber}`}
          />
        </div>
        {doneCheckbox}
      </div>
    );
  }

  return (
    <div className={rowClass} data-testid={`row-set-${set.setNumber}`}>
      {setNumberCell}

      {/* Weight — stepper pill (increment logic unchanged) + optional lb hint (kg mode only) */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className={PILL}>
          <button
            type="button"
            aria-label={`Decrease weight for set ${set.setNumber}`}
            className={STEPPER_MINUS}
            onClick={() => onFieldChange("weight", Math.max(0, Math.round(((set.weight ?? 0) - weightIncrement) * 10) / 10))}
            data-testid={`button-weight-minus-${set.setNumber}`}
          >
            <Minus className="size-4" />
          </button>
          <Input
            type="number"
            step={weightUnit === "kg" ? "0.5" : "1"}
            value={set.weight ?? ""}
            onChange={(e) => onFieldChange("weight", e.target.value === "" ? null : parseFloat(e.target.value))}
            className={FIELD_INPUT}
            data-testid={`input-weight-${set.setNumber}`}
          />
          <button
            type="button"
            aria-label={`Increase weight for set ${set.setNumber}`}
            className={STEPPER_PLUS}
            onClick={() => onFieldChange("weight", Math.round(((set.weight ?? 0) + weightIncrement) * 10) / 10)}
            data-testid={`button-weight-plus-${set.setNumber}`}
          >
            <Plus className="size-4" />
          </button>
        </div>
        {showKgConversion && set.weight != null && weightUnit === "kg" && (
          <p
            className={`text-center font-mono text-[9px] tabular-nums ${
              isHighlighted ? "text-primary/80" : "text-tertiary-foreground"
            }`}
            data-testid={`text-lbs-conversion-${set.setNumber}`}
          >
            {(set.weight * LB_PER_KG).toFixed(0)} lb
          </p>
        )}
        {ghostTarget ? (
          <p
            className="whitespace-nowrap text-center font-mono text-[9px] tabular-nums text-tertiary-foreground"
            data-testid={`text-overload-ghost-${set.setNumber}`}
          >
            {ghostTarget}
          </p>
        ) : null}
      </div>

      {/* Reps — stepper pill (whole-rep +/- over the existing onFieldChange data flow) */}
      <div className={PILL}>
        <button
          type="button"
          aria-label={`Decrease reps for set ${set.setNumber}`}
          className={STEPPER_MINUS}
          onClick={() => onFieldChange("reps", Math.max(0, (set.reps ?? 0) - 1))}
          data-testid={`button-reps-minus-${set.setNumber}`}
        >
          <Minus className="size-4" />
        </button>
        <Input
          type="number"
          value={set.reps ?? ""}
          onChange={(e) => onFieldChange("reps", e.target.value === "" ? null : parseInt(e.target.value))}
          className={FIELD_INPUT}
          data-testid={`input-reps-${set.setNumber}`}
        />
        <button
          type="button"
          aria-label={`Increase reps for set ${set.setNumber}`}
          className={STEPPER_PLUS}
          onClick={() => onFieldChange("reps", (set.reps ?? 0) + 1)}
          data-testid={`button-reps-plus-${set.setNumber}`}
        >
          <Plus className="size-4" />
        </button>
      </div>

      {doneCheckbox}
    </div>
  );
}
