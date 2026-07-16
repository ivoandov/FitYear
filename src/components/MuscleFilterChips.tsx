"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  COARSE_MUSCLE_GROUPS,
  SPECIFICS_BY_COARSE,
  resolveMuscle,
  type CoarseGroup,
} from "@/lib/muscle-groups";

const DETAILED_KEY = "fy-picker-detailed";

// The muscle filter for the exercise pickers (Design 2026-07-16): a fixed COARSE
// chip set by default, with an opt-in "Detailed" toggle that expands each coarse
// group into a labelled row of its specifics. Filtering is always by coarse
// rollup (selecting a specific still filters its whole group - lossless), so
// `value` is "All" or a coarse group name. Only groups/specifics actually
// present in the passed catalog are shown, so no empty chips. The Detailed
// preference persists across sessions.
export function MuscleFilterChips({
  exercises,
  value,
  onChange,
}: {
  exercises: { muscleGroups?: string[] }[];
  value: string; // "All" | CoarseGroup
  onChange: (v: string) => void;
}) {
  const [detailed, setDetailed] = useState(false);
  useEffect(() => {
    setDetailed(localStorage.getItem(DETAILED_KEY) === "1");
  }, []);
  const toggleDetailed = (d: boolean) => {
    setDetailed(d);
    try {
      localStorage.setItem(DETAILED_KEY, d ? "1" : "0");
    } catch {
      /* private mode - non-fatal */
    }
  };

  // Which coarse groups + specifics actually appear in this catalog.
  const { presentCoarse, specificsByCoarse } = useMemo(() => {
    const coarse = new Set<CoarseGroup>();
    const specifics = new Map<CoarseGroup, Set<string>>();
    for (const ex of exercises) {
      for (const raw of ex.muscleGroups ?? []) {
        const r = resolveMuscle(raw);
        if (!r) continue;
        coarse.add(r.coarse);
        if (r.label !== r.coarse) {
          if (!specifics.has(r.coarse)) specifics.set(r.coarse, new Set());
          specifics.get(r.coarse)!.add(r.label);
        }
      }
    }
    return { presentCoarse: coarse, specificsByCoarse: specifics };
  }, [exercises]);

  const orderedCoarse = COARSE_MUSCLE_GROUPS.filter((c) => presentCoarse.has(c));

  const chip = (label: string, active: boolean, onClick: () => void, key: string, badge?: number) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-xs font-semibold border transition-colors",
        active
          ? "bg-primary-dim border-yellow text-primary"
          : "border text-muted-foreground hover:text-foreground",
      )}
      data-testid={`filter-muscle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      {label}
      {badge ? <span className="font-mono text-[9px] text-tertiary-foreground">{badge}</span> : null}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-tertiary-foreground">
          Filter by muscle
        </span>
        <div className="inline-flex rounded-lg border p-0.5 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => toggleDetailed(false)}
            className={cn("rounded-md px-2 py-1 transition-colors", !detailed ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground")}
            data-testid="muscle-view-groups"
          >
            Groups
          </button>
          <button
            type="button"
            onClick={() => toggleDetailed(true)}
            className={cn("rounded-md px-2 py-1 transition-colors", detailed ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground")}
            data-testid="muscle-view-detailed"
          >
            Detailed
          </button>
        </div>
      </div>

      {!detailed ? (
        <div className="flex flex-wrap gap-2">
          {chip("All", value === "All", () => onChange("All"), "All")}
          {orderedCoarse.map((c) =>
            chip(c, value === c, () => onChange(c), c, specificsByCoarse.get(c)?.size),
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {chip("All", value === "All", () => onChange("All"), "All")}
          </div>
          {orderedCoarse.map((c) => {
            const specs = SPECIFICS_BY_COARSE[c].filter((s) => specificsByCoarse.get(c)?.has(s));
            const active = value === c;
            return (
              <div key={c} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onChange(c)}
                  className={cn(
                    "mt-0.5 shrink-0 rounded-md px-2.5 py-1 font-mono text-[11px] font-bold transition-colors",
                    active ? "bg-primary text-primary-foreground" : "bg-white/[0.05] text-foreground",
                  )}
                >
                  {c}
                </button>
                <div className="flex flex-wrap gap-1.5">
                  {specs.length === 0 ? (
                    <span className="mt-1 font-mono text-[10px] text-tertiary-foreground">— no specifics</span>
                  ) : (
                    specs.map((s) =>
                      chip(s, active, () => onChange(c), `${c}-${s}`),
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
