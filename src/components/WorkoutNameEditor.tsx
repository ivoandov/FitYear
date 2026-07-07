"use client";

import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";

/**
 * Inline-editable workout title on the completion summary. The name is
 * auto-generated from muscle groups when the user didn't name the workout
 * (quick-start flow); this lets them rename it right there. Optimistic: the
 * new name shows immediately and persists via PUT in the background (no reload,
 * so we don't trip the router.push+refresh-after-write rule). Reverts on error.
 */
export function WorkoutNameEditor({
  workoutId,
  initialName,
}: {
  workoutId: string;
  initialName: string;
}) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialName);
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    setEditing(false);
    setValue(name);
  };

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      cancel();
      return;
    }
    const prev = name;
    setSaving(true);
    setName(trimmed); // optimistic
    try {
      await apiRequest("PUT", `/api/completed-workouts/${workoutId}`, { name: trimmed });
      queryClient.invalidateQueries({ queryKey: ["/api/completed-workouts"] });
      setEditing(false);
    } catch (e) {
      setName(prev);
      setValue(prev);
      toast({ title: "Couldn't rename workout", description: describeApiError(e) });
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          maxLength={80}
          className="flex-1 min-w-0 bg-input border border-strong rounded-lg px-3 h-11 text-2xl sm:text-3xl font-bold outline-none focus:bg-input-focus focus:border-yellow"
          data-testid="input-workout-name"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Save name"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50 shrink-0"
          data-testid="button-save-workout-name"
        >
          <Check className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel"
          className="flex h-9 w-9 items-center justify-center rounded-lg border text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <h1 className="text-3xl font-bold" data-testid="text-workout-name">
        {name}
      </h1>
      <button
        type="button"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
        aria-label="Edit workout name"
        className="text-muted-foreground hover:text-foreground shrink-0"
        data-testid="button-edit-workout-name"
      >
        <Pencil className="h-5 w-5" />
      </button>
    </div>
  );
}
