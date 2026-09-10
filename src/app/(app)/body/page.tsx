"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DesktopTopBar } from "@/components/DesktopTopBar";
import { Sparkline } from "@/components/insights/Sparkline";
import { apiRequest, queryClient, describeApiError } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import { lbsToDisplay, displayToLbs } from "@/lib/units";
import { localDateKey } from "@/lib/date";

interface Measurement {
  id: string;
  date: string;
  weightLbs: number | null;
  bodyFatPct: number | null;
  circumferences: Record<string, number> | null;
  photoPath: string | null;
  notes: string | null;
}

const CIRCUMFERENCES: Array<[string, string]> = [
  ["chest", "Chest"],
  ["waist", "Waist"],
  ["hips", "Hips"],
  ["leftArm", "Left arm"],
  ["rightArm", "Right arm"],
  ["leftThigh", "Left thigh"],
  ["rightThigh", "Right thigh"],
];

/**
 * Body weight, composition and circumferences over time.
 *
 * The gap this fills: FitYear knew everything about what you lifted and nothing
 * about you. Weight is stored in lbs like every other weight in the app and
 * converted for display, and the date is an authored day - "my weight on
 * Tuesday" - so it never moves across a timezone.
 */
export default function BodyPage() {
  // The display unit lives on the server settings row, not the local settings
  // provider - same source the tracker reads, so the two never disagree.
  const { data: userSettingsData } = useQuery<{ weightUnit?: string }>({
    queryKey: ["/api/user-settings"],
  });
  const weightUnit = (userSettingsData?.weightUnit ?? "lbs") as "lbs" | "kg";
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => localDateKey(new Date()));
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [circ, setCirc] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");

  const { data: rows = [], isLoading } = useQuery<Measurement[]>({
    queryKey: ["/api/body-measurements"],
  });

  const save = useMutation({
    mutationFn: async () => {
      const circumferences: Record<string, number> = {};
      for (const [key] of CIRCUMFERENCES) {
        const v = parseFloat(circ[key] ?? "");
        if (Number.isFinite(v) && v > 0) circumferences[key] = v;
      }
      const w = parseFloat(weight);
      const bf = parseFloat(bodyFat);
      await apiRequest("POST", "/api/body-measurements", {
        date,
        weightLbs: Number.isFinite(w) ? displayToLbs(w, weightUnit) : null,
        bodyFatPct: Number.isFinite(bf) ? bf : null,
        circumferences: Object.keys(circumferences).length ? circumferences : null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/body-measurements"] });
      toast({ title: "Saved" });
      setOpen(false);
      setWeight("");
      setBodyFat("");
      setCirc({});
      setNotes("");
    },
    onError: (e: Error) =>
      toast({ title: "Couldn't save", description: describeApiError(e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/body-measurements/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/body-measurements"] }),
  });

  // Oldest first for the chart; the list below stays newest first.
  const series = useMemo(
    () =>
      [...rows]
        .filter((r) => r.weightLbs != null)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => lbsToDisplay(r.weightLbs as number, weightUnit) ?? 0),
    [rows, weightUnit],
  );
  const latest = rows[0];
  const change =
    series.length >= 2 ? Math.round((series[series.length - 1] - series[0]) * 10) / 10 : null;

  return (
    <div className="pb-24 md:pb-10">
      <DesktopTopBar title="Body" />

      <header className="px-5 pt-5 md:hidden">
        <Link
          href="/history"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> History
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.02em]">Body</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Weight and measurements over time</p>
      </header>

      <div className="space-y-4 px-5 pt-5 md:px-0">
        <div className="card-elevated p-4">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-tertiary-foreground">
              Weight
            </div>
            {change != null && (
              <div className="font-mono text-[12px] tabular-nums text-muted-foreground">
                {change > 0 ? "+" : ""}
                {change} {weightUnit} since start
              </div>
            )}
          </div>
          {series.length >= 2 ? (
            <>
              <div className="mt-1 font-mono text-[28px] font-bold tabular-nums text-foreground">
                {series[series.length - 1]}
                <span className="ml-1 text-[13px] font-normal text-tertiary-foreground">
                  {weightUnit}
                </span>
              </div>
              <div className="mt-2">
                <Sparkline values={series} />
              </div>
            </>
          ) : (
            <p className="mt-2 text-[14px] text-muted-foreground">
              {isLoading ? "Loading…" : "Log your weight twice to see a trend."}
            </p>
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="w-full" data-testid="button-add-measurement">
              <Plus className="mr-1.5 h-4 w-4" /> Log measurement
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Log measurement</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="m-date">Date</Label>
                <Input
                  id="m-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="input-measurement-date"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="m-weight">Weight ({weightUnit})</Label>
                  <Input
                    id="m-weight"
                    type="number"
                    step="0.1"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    data-testid="input-measurement-weight"
                  />
                </div>
                <div>
                  <Label htmlFor="m-bf">Body fat (%)</Label>
                  <Input
                    id="m-bf"
                    type="number"
                    step="0.1"
                    value={bodyFat}
                    onChange={(e) => setBodyFat(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {CIRCUMFERENCES.map(([key, label]) => (
                  <div key={key}>
                    <Label htmlFor={`m-${key}`}>{label} (in)</Label>
                    <Input
                      id={`m-${key}`}
                      type="number"
                      step="0.1"
                      value={circ[key] ?? ""}
                      onChange={(e) => setCirc({ ...circ, [key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div>
                <Label htmlFor="m-notes">Notes</Label>
                <Input
                  id="m-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <Button
                className="w-full"
                disabled={save.isPending}
                onClick={() => save.mutate()}
                data-testid="button-save-measurement"
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {rows.length > 0 && (
          <div className="space-y-2">
            <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-tertiary-foreground">
              Entries
            </span>
            {rows.map((r) => (
              <div
                key={r.id}
                className="card-elevated flex items-center gap-3 p-3"
                data-testid={`row-measurement-${r.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] tabular-nums text-foreground">
                    {r.date}
                    {r.weightLbs != null && (
                      <span className="ml-2 font-semibold">
                        {lbsToDisplay(r.weightLbs, weightUnit)} {weightUnit}
                      </span>
                    )}
                    {r.bodyFatPct != null && (
                      <span className="ml-2 text-muted-foreground">{r.bodyFatPct}%</span>
                    )}
                  </div>
                  {r.notes && (
                    <div className="mt-0.5 text-[12px] text-tertiary-foreground">{r.notes}</div>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Delete measurement for ${r.date}`}
                  onClick={() => remove.mutate(r.id)}
                  className="text-tertiary-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
