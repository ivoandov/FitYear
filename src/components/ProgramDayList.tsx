"use client";

import { lbsToDisplay, type WeightUnit } from "@/lib/units";

/**
 * A program, day by day, with the exercises actually in it.
 *
 * Ivo, 2026-09-22, after building a program end to end: "when the routine was
 * finished, there was nowhere to actually see all of the exercises in the
 * routine. It was just this: here are the 7 days and the names for each day,
 * but I couldn't really see what each day meant." Both places that show a
 * program - the builder's review screen and a routine's detail view - render
 * this, so neither can go back to being a list of names.
 *
 * Reps stay STRINGS ("6-8", "AMRAP", "30s"): a program's prescription is free
 * text and collapsing a range to a number is the exact bug the string type
 * exists to prevent.
 */

export type ProgramListExercise = {
  name: string;
  sets?: number | null;
  reps?: string | number | null;
  rest?: number | null;
  targetLoadLbs?: number | null;
  notes?: string | null;
};

export type ProgramListDay = {
  dayIndex: number;
  workoutName: string;
  isRest?: boolean;
  exercises: ProgramListExercise[];
};

function restLabel(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s rest`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min rest`;
}

export function ProgramDayList({
  days,
  weightUnit,
  emptyLabel = "No exercises yet.",
}: {
  days: ProgramListDay[];
  weightUnit: WeightUnit;
  emptyLabel?: string;
}) {
  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2.5" data-testid="program-day-list">
      {days.map((day) => (
        <div
          key={day.dayIndex}
          className="card-elevated overflow-hidden"
          data-testid={`program-day-${day.dayIndex}`}
        >
          <div className="flex items-baseline gap-2.5 border-b border-divider px-4 py-2.5">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-tertiary-foreground">
              Day {day.dayIndex}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[15px] font-semibold ${
                day.isRest ? "text-tertiary-foreground" : "text-foreground"
              }`}
            >
              {day.isRest ? "Rest" : day.workoutName}
            </span>
            {!day.isRest && day.exercises.length > 0 && (
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
                {day.exercises.length} exercises
              </span>
            )}
          </div>

          {!day.isRest && (
            <ul className="divide-y divide-divider">
              {day.exercises.length === 0 ? (
                <li className="px-4 py-2.5 text-sm text-muted-foreground">Nothing planned.</li>
              ) : (
                day.exercises.map((ex, i) => {
                  const load =
                    typeof ex.targetLoadLbs === "number" && ex.targetLoadLbs > 0
                      ? `${lbsToDisplay(ex.targetLoadLbs, weightUnit)} ${weightUnit}`
                      : null;
                  const rest = restLabel(ex.rest);
                  return (
                    <li key={`${ex.name}-${i}`} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-sm font-medium text-foreground">{ex.name}</span>
                        <span className="shrink-0 font-mono text-[12px] text-muted-foreground">
                          {ex.sets ?? "?"} x {String(ex.reps ?? "?")}
                        </span>
                      </div>
                      {(load || rest || ex.notes) && (
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-tertiary-foreground">
                          {[load, rest].filter(Boolean).join(" · ")}
                          {ex.notes ? (
                            <span className="block normal-case tracking-normal">{ex.notes}</span>
                          ) : null}
                        </div>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
