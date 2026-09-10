"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { clientTimeZone } from "@/lib/date";
import type { EditedRoutine } from "@/lib/routine-edit-schema";

interface BeforeDay {
  dayIndex: number;
  workoutName: string;
  exercises: unknown[];
}
interface EditResponse {
  routineId: string;
  routineName: string;
  before: { name: string; days: BeforeDay[] };
  after: EditedRoutine;
}

const EXAMPLES = [
  "Make it 4 days a week instead of 5",
  "Add accessory work for the muscle groups I'm behind on",
  "Swap anything that aggravates my left shoulder",
];

/**
 * Change a routine by describing the change.
 *
 * Two-step on purpose: FitBot proposes, the user reads the diff, and only then
 * does anything get written. A routine has live scheduled workouts hanging off
 * it, so an AI edit that saved itself would be a bad way to discover the model
 * misread you.
 */
export function RoutineEditDialog({
  routineId,
  routineName,
  open,
  onOpenChange,
  onSaved,
}: {
  routineId: string;
  routineName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /**
   * Fired after the routine is written, so the page can offer the same
   * "update the remaining scheduled workouts?" prompt the hand editor does.
   * Without it an AI edit rewrote the routine and silently left the program
   * the user is actually training off on the old plan.
   */
  onSaved?: (routineId: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<EditResponse | null>(null);

  const propose = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest(
        "POST",
        `/api/ai/edit-routine?tz=${encodeURIComponent(clientTimeZone())}`,
        { routineId, instruction: text },
      );
      return (await res.json()) as EditResponse;
    },
    onSuccess: (data) => setProposal(data),
    onError: (e: Error) =>
      toast({ title: "Couldn't apply that", description: describeApiError(e), variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: async (edited: EditedRoutine) => {
      await apiRequest("PUT", `/api/routines/${routineId}`, {
        entries: edited.days.map((d) => ({
          dayIndex: d.dayIndex,
          workoutName: d.workoutName,
          workoutTemplateId: null,
          exercises: d.exercises,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workout-templates/routine-usage"] });
      toast({ title: "Routine updated" });
      reset();
      onOpenChange(false);
      onSaved?.(routineId);
    },
    onError: (e: Error) =>
      toast({ title: "Couldn't save", description: describeApiError(e), variant: "destructive" }),
  });

  function reset() {
    setInstruction("");
    setProposal(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-[18px] w-[18px] text-primary" />
            Change {routineName}
          </DialogTitle>
          <DialogDescription>
            Describe what you want different. FitBot can see what you have been training,
            so you can ask it to fill in what you are behind on.
          </DialogDescription>
        </DialogHeader>

        {!proposal ? (
          <div className="space-y-3">
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Make it 4 days a week and add accessory work where I'm low…"
              rows={4}
              data-testid="input-routine-instruction"
            />
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setInstruction(ex)}
                  className="rounded-full border border-card-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
            <Button
              className="w-full"
              disabled={!instruction.trim() || propose.isPending}
              onClick={() => propose.mutate(instruction.trim())}
              data-testid="button-propose-routine-edit"
            >
              {propose.isPending ? "Thinking…" : "Show me the change"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {proposal.after.summary && (
              <p className="text-[14px] text-foreground">{proposal.after.summary}</p>
            )}

            {proposal.after.changes.length > 0 && (
              <ul className="space-y-1">
                {proposal.after.changes.map((c, i) => (
                  <li key={i} className="text-[13px] leading-snug text-muted-foreground">
                    <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-tertiary-foreground">
                      {c.type}
                    </span>{" "}
                    {c.detail}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-tertiary-foreground">
              {proposal.before.days.length} days <ArrowRight className="h-3 w-3" />{" "}
              {proposal.after.days.length} days
            </div>

            <div className="space-y-2">
              {proposal.after.days.map((d) => (
                <div key={d.dayIndex} className="rounded-xl border border-card-border p-3">
                  <div className="text-[13px] font-semibold text-foreground">
                    Day {d.dayIndex} · {d.workoutName}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {d.exercises.map((ex, i) => (
                      <li key={i} className="font-mono text-[12px] tabular-nums text-muted-foreground">
                        {ex.name} · {ex.sets} x {ex.reps}
                        {ex.targetLoadLbs ? ` @ ${ex.targetLoadLbs}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Try again
              </Button>
              <Button
                className="flex-1"
                disabled={save.isPending}
                onClick={() => save.mutate(proposal.after)}
                data-testid="button-save-routine-edit"
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
            <p className="text-[12px] leading-snug text-tertiary-foreground">
              Saving replaces this routine&apos;s days. If it is running, you will be asked
              whether the workouts already on your calendar should follow the change.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
