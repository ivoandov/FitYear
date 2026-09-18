"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { apiRequest, describeApiError, invalidateCompletedWorkouts } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { formatDuration, parseDurationInput } from "@/lib/workout-duration";

/**
 * A workout's duration, correctable in place.
 *
 * Ivo, 2026-09-18: "i also want to be able to edit the duration of a workout in
 * the summary and history". History could already do it, but only three taps
 * deep - expand the card, press Edit, find the field - and the summary could
 * not at all, which is exactly where a wrong number is first seen: finishing
 * late records the idle tail as training time, and the screen right after
 * Finish is where it shows.
 *
 * Tap the number, type "55", "1h 5m" or "1:05", save. Optimistic like the name
 * editor on the same screen, and it writes through the same PUT History's full
 * editor uses, which keeps `started_at` consistent with the new length.
 */
export function WorkoutDurationEditor({
  workoutId,
  seconds,
  valueClassName,
  testIdSuffix,
  valueTestId,
  onSaved,
}: {
  workoutId: string;
  seconds: number | null;
  valueClassName: string;
  testIdSuffix: string;
  /** Overrides the value's test id, for a surface whose specs already name it. */
  valueTestId?: string;
  onSaved?: (seconds: number) => void;
}) {
  const [shown, setShown] = useState(seconds);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    setEditing(false);
    setValue("");
  };

  const save = async () => {
    const parsed = parseDurationInput(value);
    if (parsed === null) {
      toast({ title: "Couldn't read that duration", description: "Try 55, 1h 5m or 1:05." });
      return;
    }
    // Same ceiling the route enforces, stated here so the message is useful.
    if (parsed > 24 * 60 * 60) {
      toast({ title: "That's longer than a day", description: "Enter the time you actually trained." });
      return;
    }
    if (parsed === Math.round(shown ?? -1)) {
      cancel();
      return;
    }
    const prev = shown;
    setSaving(true);
    setShown(parsed); // optimistic
    try {
      await apiRequest("PUT", `/api/completed-workouts/${workoutId}`, { durationSeconds: parsed });
      invalidateCompletedWorkouts();
      onSaved?.(parsed);
      setEditing(false);
      setValue("");
    } catch (e) {
      setShown(prev);
      toast({ title: "Couldn't change the duration", description: describeApiError(e) });
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={value}
          placeholder="1h 5m"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          aria-label="Duration, for example 55, 1h 5m or 1:05"
          className="h-9 w-24 min-w-0 rounded-lg border border-strong bg-input px-2 font-mono text-base font-bold outline-none focus:border-yellow focus:bg-input-focus"
          data-testid={`input-inline-duration-${testIdSuffix}`}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Save duration"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
          data-testid={`button-save-inline-duration-${testIdSuffix}`}
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(formatDuration(shown));
        setEditing(true);
      }}
      aria-label="Edit duration"
      className="group inline-flex items-center gap-1.5 text-left"
      data-testid={`button-inline-duration-${testIdSuffix}`}
    >
      <span className={valueClassName} data-testid={valueTestId ?? `text-inline-duration-${testIdSuffix}`}>
        {formatDuration(shown) || "-"}
      </span>
      <Pencil className="h-3 w-3 shrink-0 text-tertiary-foreground group-hover:text-foreground" />
    </button>
  );
}
