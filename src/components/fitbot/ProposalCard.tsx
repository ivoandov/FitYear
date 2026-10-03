"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";
import { ProgramDayList, type ProgramListDay } from "@/components/ProgramDayList";
import { describeRule, normalizeRule, type MaybeRule } from "@/lib/progression";
import {
  describeStart,
  fieldLabel,
  formatDayKey,
  proposalConsequence,
  proposalTitle,
  type ProposalStatus,
} from "@/lib/fitbot-proposals";
import type { WeightUnit } from "@/lib/units";

export type ChatProposal = {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  /** Resolved locally rather than trusted from the stream. */
  status: ProposalStatus;
};

const STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: "Waiting for you",
  approved: "Applied",
  rejected: "Declined",
  failed: "Could not apply",
  superseded: "Replaced by a newer version below",
};

/**
 * One thing FitBot wants to change, readable enough that Approve is an
 * informed decision.
 *
 * Ivo, 2026-10-03: FitBot "made one and just asked me to approve without
 * actually showing me the whole thing." The start card read
 * "startDate: 2026-10-05 / durationWeeks: 12" and nothing else, so he had to ask
 * for the routine in text. A pending card now shows everything approving it
 * would do: a routine change lists every day with sets, reps, load, rest and
 * notes; a start says when it begins and ends and shows the routine it will
 * schedule. A decided card folds away to its summary, so a long conversation
 * does not become a wall of old routines.
 */
export function ProposalCard({
  proposal,
  weightUnit,
  routineChangeWaiting,
  applying,
  onApprove,
  onReject,
}: {
  proposal: ChatProposal;
  weightUnit: WeightUnit;
  /** A start card whose routine still has an unapproved change above it. */
  routineChangeWaiting: boolean;
  applying: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const pending = proposal.status === "pending";
  const consequence = proposalConsequence(proposal.tool);

  return (
    <div
      className={`rounded-[16px] p-4 ${
        pending ? "border-yellow bg-primary-dim" : "border-strong bg-white/[0.02]"
      }`}
      data-testid="chat-proposal"
      data-status={proposal.status}
    >
      <div
        className={`font-mono text-[11px] uppercase tracking-[0.2em] ${
          pending ? "text-primary" : "text-tertiary-foreground"
        }`}
        data-testid="text-proposal-title"
      >
        {proposalTitle(proposal.tool)}
      </div>
      <p className={`mt-2 text-[15px] ${pending ? "text-foreground" : "text-muted-foreground"}`}>
        {proposal.summary}
      </p>

      {pending && (
        <>
          {consequence && (
            <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground" data-testid="text-proposal-consequence">
              {consequence}
            </p>
          )}
          <ProposalDetail proposal={proposal} weightUnit={weightUnit} />
          {routineChangeWaiting && (
            <div
              className="mt-3 flex gap-2 rounded-xl border-strong bg-white/[0.04] p-3 text-[13px] leading-snug text-foreground"
              data-testid="warning-routine-change-waiting"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              A change to this routine above has not been approved yet. Approve it first, or the
              program starts with the routine as it is saved now.
            </div>
          )}
        </>
      )}

      {pending ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={applying}
            data-testid="button-approve-proposal"
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-sm font-bold text-primary-foreground shadow-cta disabled:opacity-60"
          >
            <Check className="h-4 w-4" />
            {applying ? "Applying..." : "Approve"}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={applying}
            data-testid="button-reject-proposal"
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border-strong bg-white/[0.03] text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            <X className="h-4 w-4" />
            No
          </button>
        </div>
      ) : (
        <div
          className="mt-3 font-mono text-[11px] uppercase tracking-[0.12em] text-tertiary-foreground"
          data-testid="text-proposal-status"
        >
          {STATUS_LABEL[proposal.status]}
        </div>
      )}
      {pending && (
        <p className="mt-2 text-[12px] leading-snug text-tertiary-foreground">
          Or just tell it what to change instead.
        </p>
      )}
    </div>
  );
}

/** A routine day as FitBot sends it, in the shape the shared day list draws. */
function toProgramDays(raw: unknown): ProgramListDay[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => d as Record<string, unknown>)
    .map((d) => ({
      dayIndex: Number(d.dayIndex),
      workoutName: String(d.workoutName ?? "") || `Day ${String(d.dayIndex)}`,
      isRest: false,
      exercises: (Array.isArray(d.exercises) ? d.exercises : []) as ProgramListDay["exercises"],
    }))
    .sort((a, b) => a.dayIndex - b.dayIndex);
}

function ProposalDetail({ proposal, weightUnit }: { proposal: ChatProposal; weightUnit: WeightUnit }) {
  const { tool, input } = proposal;

  if (tool === "propose_routine_change") {
    const rule = input.progression !== undefined ? describeRule(normalizeRule(input.progression as MaybeRule), weightUnit) : null;
    return (
      <div className="mt-3 space-y-2" data-testid="proposal-routine-days">
        {input.progression !== undefined && (
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-tertiary-foreground">
            Progression: {rule ?? "none"}
          </p>
        )}
        <ProgramDayList days={toProgramDays(input.days)} weightUnit={weightUnit} />
      </div>
    );
  }

  if (tool === "propose_start_routine") {
    return <StartDetail input={input} weightUnit={weightUnit} />;
  }

  // The rest are small: a few labelled fields, days in words, exercises listed.
  const skip = new Set(["summary", "routineId", "scheduledWorkoutId", "programId", "exercises"]);
  const fields = Object.entries(input).filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && v !== "");
  const exercises = Array.isArray(input.exercises) ? (input.exercises as Record<string, unknown>[]) : [];
  if (fields.length === 0 && exercises.length === 0) return null;

  const show = (key: string, value: unknown): string => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDayKey(value);
    if (Array.isArray(value)) return value.map(String).join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };
  const label = (key: string) =>
    tool === "propose_update_scheduled_workout" && (key === "date" || key === "name")
      ? `New ${key}`
      : fieldLabel(key);

  return (
    <div className="mt-3 space-y-1" data-testid="proposal-fields">
      {fields.map(([k, v]) => (
        <div key={k} className="flex gap-2 text-[13px]">
          <span className="shrink-0 text-tertiary-foreground">{label(k)}</span>
          <span className="min-w-0 text-foreground">{show(k, v)}</span>
        </div>
      ))}
      {exercises.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {exercises.map((e, j) => (
            <li key={j} className="font-mono text-[12px] tabular-nums text-muted-foreground">
              {String(e.name)} · {String(e.sets ?? "?")} x {String(e.reps ?? "?")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type RoutineEntryLite = {
  dayIndex: number;
  workoutName?: string | null;
  workoutTemplateId?: string | null;
  exercises?: unknown;
};

/**
 * When the program starts and ends, and the routine it will put on the calendar.
 *
 * The routine is fetched rather than carried in the proposal: a start names a
 * routine by id, and what gets scheduled is that routine as SAVED, which is
 * exactly what this shows. Open by default while the card is pending, because
 * the whole complaint was having to ask.
 */
function StartDetail({ input, weightUnit }: { input: Record<string, unknown>; weightUnit: WeightUnit }) {
  const [open, setOpen] = useState(true);
  const routineId = typeof input.routineId === "string" ? input.routineId : "";
  const when = describeStart(input);

  const { data: routine, isLoading, isError } = useQuery<{ name?: string; entries?: RoutineEntryLite[] }>({
    queryKey: [`/api/routines/${routineId}`],
    enabled: open && routineId !== "",
  });
  const needsTemplates = (routine?.entries ?? []).some(
    (e) => e.workoutTemplateId && !(Array.isArray(e.exercises) && e.exercises.length > 0),
  );
  const { data: templates } = useQuery<{ id: string; name: string; exercises?: unknown }[]>({
    queryKey: ["/api/workout-templates"],
    enabled: open && needsTemplates,
  });

  // Same rule as the routine detail dialog: a day is inline exercises (FitBot)
  // or a template reference (hand-built), and the template holds them then.
  const days: ProgramListDay[] = [...(routine?.entries ?? [])]
    .sort((a, b) => a.dayIndex - b.dayIndex)
    .map((entry) => {
      const inline = (Array.isArray(entry.exercises) ? entry.exercises : []) as ProgramListDay["exercises"];
      const template = entry.workoutTemplateId ? templates?.find((t) => t.id === entry.workoutTemplateId) : undefined;
      const fromTemplate = (Array.isArray(template?.exercises) ? template.exercises : []) as ProgramListDay["exercises"];
      return {
        dayIndex: entry.dayIndex,
        workoutName: entry.workoutName || template?.name || `Day ${entry.dayIndex}`,
        isRest: false,
        exercises: inline.length > 0 ? inline : fromTemplate,
      };
    });

  return (
    <div className="mt-3 space-y-2">
      {when && (
        <p className="text-[14px] font-semibold text-foreground" data-testid="text-proposal-start">
          {when}
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        data-testid="button-toggle-start-routine"
        aria-expanded={open}
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
        {open ? "Hide the routine" : "Show the routine"}
      </button>
      {open && (
        <div data-testid="proposal-start-routine">
          {isError ? (
            <p className="text-[13px] text-muted-foreground">Could not load the routine. It is on the Routines page.</p>
          ) : (
            <ProgramDayList
              days={days}
              weightUnit={weightUnit}
              emptyLabel={isLoading ? "Loading the routine..." : "This routine has no days yet."}
            />
          )}
        </div>
      )}
    </div>
  );
}
