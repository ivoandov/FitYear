"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { COACH_NOTE_KINDS, type CoachNoteKind } from "@/lib/coach-notes";

/**
 * Everything FitBot remembers about you, and the controls to correct it.
 *
 * This screen is why FitBot is allowed to write memory during a conversation
 * without asking permission first. Every other write it makes is a proposal
 * with an Approve button, and memory is the deliberate exception - because a
 * coach that asks before remembering your injury is not a coach. The exception
 * is only defensible while the memory is fully visible and one tap from being
 * deleted, which is this card's whole job.
 *
 * Notes you add here are marked as yours, and FitBot is told not to rewrite or
 * drop those without asking. What you say about your own body outranks what it
 * inferred from your workout rows.
 */

const CARD = "card-elevated p-[18px]";
const EYEBROW = "font-mono text-[11px] uppercase tracking-[0.14em] text-tertiary-foreground";

type CoachNote = {
  id: string;
  kind: CoachNoteKind;
  content: string;
  expiresOn: string | null;
  source: "fitbot" | "user";
  createdAt: string;
};

/**
 * Plain-language headings. The stored vocabulary is for the model; nobody
 * opening Settings should have to work out what a "constraint" is.
 */
const KIND_LABELS: Record<CoachNoteKind, string> = {
  constraint: "Limits and injuries",
  goal: "Goals",
  agreement: "Agreed with FitBot",
  preference: "Preferences",
  context: "Life context",
};

const KIND_ORDER: CoachNoteKind[] = [
  "constraint",
  "goal",
  "agreement",
  "preference",
  "context",
];

export function CoachMemoryCard() {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<CoachNoteKind>("constraint");

  const { data: notes, isLoading } = useQuery<CoachNote[]>({
    queryKey: ["/api/coach-notes"],
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/coach-notes"] });

  const add = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/coach-notes", {
        kind,
        content: draft.trim(),
      });
    },
    onSuccess: () => {
      setDraft("");
      setAdding(false);
      void invalidate();
      toast({ title: "FitBot will remember that" });
    },
    onError: (e) =>
      toast({
        title: "Couldn't save that",
        description: describeApiError(e),
        variant: "destructive",
      }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/coach-notes/${id}`);
    },
    onSuccess: () => {
      void invalidate();
      toast({ title: "Forgotten" });
    },
    onError: (e) =>
      toast({
        title: "Couldn't remove that",
        description: describeApiError(e),
        variant: "destructive",
      }),
  });

  const today = new Date().toISOString().slice(0, 10);
  // Expired notes are hidden rather than shown struck through: this is a list
  // of what FitBot currently believes, and something it has stopped using does
  // not belong on it.
  const live = (notes ?? []).filter((n) => !n.expiresOn || n.expiresOn >= today);

  return (
    <div className={CARD} data-testid="card-coach-memory">
      <div className={`${EYEBROW} mb-1`}>What FitBot knows about you</div>
      <p className="mb-4 text-xs text-muted-foreground">
        FitBot writes these down as you talk so it does not start from scratch every
        time. Remove anything that is wrong or out of date.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : live.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-memory-empty">
          Nothing yet. Have a conversation with FitBot, or add something yourself.
        </p>
      ) : (
        <div className="space-y-4">
          {KIND_ORDER.map((k) => {
            const group = live.filter((n) => n.kind === k);
            if (group.length === 0) return null;
            return (
              <div key={k}>
                <div className={`${EYEBROW} mb-2`}>{KIND_LABELS[k]}</div>
                <ul className="space-y-1.5">
                  {group.map((n) => (
                    <li
                      key={n.id}
                      data-testid={`memory-note-${n.id}`}
                      className="flex items-start justify-between gap-3 rounded-[10px] border bg-white/[0.02] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">{n.content}</p>
                        {(n.expiresOn || n.source === "user") && (
                          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-tertiary-foreground">
                            {n.source === "user" ? "Added by you" : null}
                            {n.source === "user" && n.expiresOn ? " · " : null}
                            {n.expiresOn ? `Until ${n.expiresOn}` : null}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label={`Forget: ${n.content}`}
                        data-testid={`button-forget-${n.id}`}
                        onClick={() => remove.mutate(n.id)}
                        className="mt-0.5 shrink-0 text-tertiary-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-1">
            {COACH_NOTE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.08em] ${
                  kind === k
                    ? "bg-primary font-bold text-primary-foreground"
                    : "border-strong bg-white/[0.03] text-muted-foreground"
                }`}
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={400}
            placeholder="Left shoulder hurts on overhead pressing"
            data-testid="input-memory-content"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!draft.trim() || add.isPending}
              onClick={() => add.mutate()}
              data-testid="button-save-memory"
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          data-testid="button-add-memory"
          className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <Plus className="h-4 w-4" />
          Tell FitBot something
        </button>
      )}
    </div>
  );
}
