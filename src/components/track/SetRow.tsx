"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  onFieldChange: (field: Field, value: number | null) => void;
  onToggleComplete: (checked: boolean) => void;
}

/**
 * A single tracked set row. Presentational: all state lives in TrackPage, which
 * passes the row's flags + field/complete callbacks. Renders the distance/time
 * columns for cardio exercises, else the weight (with +/- steppers + optional
 * kg/lbs hint + PR badge) / reps columns. Extracted from TrackPage's ~230-line
 * inline duplicate; testIds + classes preserved.
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
  onFieldChange,
  onToggleComplete,
}: SetRowProps) {
  const doneCell = set.completed
    ? "bg-transparent border-transparent text-muted-foreground"
    : "";

  const doneCheckbox = (
    <div className="flex justify-center">
      <Checkbox
        checked={set.completed}
        onCheckedChange={(checked) => onToggleComplete(!!checked)}
        data-testid={`checkbox-complete-${set.setNumber}`}
        className="h-5 w-5 sm:h-6 sm:w-6"
      />
    </div>
  );

  if (isDistanceTime) {
    return (
      <div
        className={`grid grid-cols-4 gap-2 sm:gap-4 items-center py-2 rounded-md px-2 border-l-2 ${
          isActive
            ? "border-l-primary bg-primary-dim"
            : isCurrentSet
              ? "border-l-muted-foreground/30"
              : "border-l-transparent"
        }`}
        data-testid={`row-set-${set.setNumber}`}
      >
        <div className="font-medium text-sm sm:text-base">{set.setNumber}</div>
        <Input
          type="number"
          step="0.1"
          value={set.distance ?? ""}
          onChange={(e) => onFieldChange("distance", e.target.value === "" ? null : parseFloat(e.target.value))}
          className={`text-center text-sm h-9 sm:h-10 ${doneCell}`}
          data-testid={`input-distance-${set.setNumber}`}
        />
        <Input
          type="number"
          value={set.time ?? ""}
          onChange={(e) => onFieldChange("time", e.target.value === "" ? null : parseInt(e.target.value))}
          className={`text-center text-sm h-9 sm:h-10 ${doneCell}`}
          data-testid={`input-time-${set.setNumber}`}
        />
        {doneCheckbox}
      </div>
    );
  }

  return (
    <div
      className={`grid grid-cols-[2rem_1fr_4.5rem_2.5rem] sm:grid-cols-[2.5rem_1fr_6rem_2.5rem] gap-x-2 sm:gap-x-3 items-center py-2 rounded-md px-2 border-l-2 ${
        isPR
          ? "border-l-primary bg-primary-dim"
          : isActive
            ? "border-l-primary bg-primary-dim"
            : isCurrentSet
              ? "border-l-muted-foreground/30"
              : "border-l-transparent"
      }`}
      data-testid={`row-set-${set.setNumber}`}
    >
      <div className="flex items-center gap-1 font-medium text-sm sm:text-base">
        {set.setNumber}
        {isPR ? (
          <span
            className="rounded bg-primary/20 px-1 py-0.5 text-[10px] font-bold text-primary uppercase tracking-wide"
            data-testid={`pr-badge-${set.setNumber}`}
          >
            PR
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1 sm:gap-1.5 justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-1.5 text-xs font-semibold shrink-0"
            onClick={() => onFieldChange("weight", Math.max(0, Math.round(((set.weight ?? 0) - weightIncrement) * 10) / 10))}
            data-testid={`button-weight-minus-${set.setNumber}`}
          >
            -{weightIncrement}
          </Button>
          <Input
            type="number"
            step={weightUnit === "kg" ? "0.5" : "1"}
            value={set.weight ?? ""}
            onChange={(e) => onFieldChange("weight", e.target.value === "" ? null : parseFloat(e.target.value))}
            className={`text-center text-sm h-9 sm:h-10 flex-1 min-w-0 ${doneCell}`}
            data-testid={`input-weight-${set.setNumber}`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="px-1.5 text-xs font-semibold shrink-0"
            onClick={() => onFieldChange("weight", Math.round(((set.weight ?? 0) + weightIncrement) * 10) / 10)}
            data-testid={`button-weight-plus-${set.setNumber}`}
          >
            +{weightIncrement}
          </Button>
        </div>
        {showKgConversion && set.weight != null && weightUnit === "lbs" && (
          <p className="text-xs text-muted-foreground text-center tabular-nums" data-testid={`text-kg-conversion-${set.setNumber}`}>
            {(set.weight / LB_PER_KG).toFixed(1)} kg
          </p>
        )}
        {showKgConversion && set.weight != null && weightUnit === "kg" && (
          <p className="text-xs text-muted-foreground text-center tabular-nums" data-testid={`text-lbs-conversion-${set.setNumber}`}>
            {(set.weight * LB_PER_KG).toFixed(0)} lbs
          </p>
        )}
      </div>
      <Input
        type="number"
        value={set.reps ?? ""}
        onChange={(e) => onFieldChange("reps", e.target.value === "" ? null : parseInt(e.target.value))}
        className={`text-center text-sm h-9 sm:h-10 ${doneCell}`}
        data-testid={`input-reps-${set.setNumber}`}
      />
      {doneCheckbox}
    </div>
  );
}
