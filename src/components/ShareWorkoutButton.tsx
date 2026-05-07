"use client";

import { useRef, useState } from "react";
import { Share2, Loader2, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  workoutName: string;
  date: string;
  durationLabel: string;
  totalSets: number;
  totalVolumeLbs: number;
  exerciseCount: number;
  muscleGroups: Array<[string, number]>;
  prCount: number;
  streakDays: number;
}

export function ShareWorkoutButton(props: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const summary = [
    `💪 ${props.workoutName}`,
    `${props.date}`,
    "",
    `Duration: ${props.durationLabel}`,
    `Sets: ${props.totalSets}`,
    `Volume: ${props.totalVolumeLbs.toLocaleString()} lbs`,
    `Exercises: ${props.exerciseCount}`,
    props.prCount > 0 ? `🏆 ${props.prCount} new PR${props.prCount !== 1 ? "s" : ""}` : null,
    props.streakDays > 0 ? `🔥 ${props.streakDays} day streak` : null,
    "",
    "Tracked with FitYear",
  ]
    .filter(Boolean)
    .join("\n");

  async function captureAsBlob(): Promise<Blob | null> {
    if (!cardRef.current) return null;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
      });
      return await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
    } catch {
      return null;
    }
  }

  async function handleNativeShare() {
    setBusy(true);
    try {
      const blob = await captureAsBlob();
      if (!blob) {
        if (navigator.share) {
          await navigator.share({ text: summary });
        }
        return;
      }
      const file = new File([blob], "fityear-workout.png", { type: "image/png" });
      // Prefer file share when supported
      if (
        navigator.canShare &&
        navigator.canShare({ files: [file] }) &&
        navigator.share
      ) {
        await navigator.share({ files: [file], text: summary });
      } else if (navigator.share) {
        await navigator.share({ text: summary });
      } else {
        // Desktop fallback: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "fityear-workout.png";
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      /* user cancelled, no-op */
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-secondary text-secondary-foreground text-sm font-medium hover:bg-secondary/80"
        >
          <Share2 className="h-4 w-4" />
          Share Workout
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogTitle>Share workout</DialogTitle>
        <DialogDescription className="sr-only">
          Preview and share your workout summary
        </DialogDescription>

        {/* Capture target — styled like the Instagram preview card */}
        <div
          ref={cardRef}
          className="rounded-2xl p-6 text-white relative overflow-hidden"
          style={{
            background:
              "radial-gradient(at 30% 20%, hsl(150 60% 25%) 0%, hsl(150 70% 12%) 70%)",
            backgroundImage:
              "radial-gradient(at 30% 20%, hsl(150 60% 25%) 0%, hsl(150 70% 12%) 70%), linear-gradient(0deg, transparent 24%, rgba(255,255,255,0.05) 25%, rgba(255,255,255,0.05) 26%, transparent 27%, transparent 74%, rgba(255,255,255,0.05) 75%, rgba(255,255,255,0.05) 76%, transparent 77%)",
            backgroundSize: "100%, 50px 50px",
          }}
        >
          <div className="text-xs uppercase tracking-widest opacity-80">FitYear</div>
          <div className="mt-3 text-2xl font-bold">{props.workoutName}</div>
          <div className="text-xs opacity-70">{props.date}</div>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Duration" value={props.durationLabel} />
            <Stat label="Sets" value={props.totalSets.toString()} />
            <Stat label="Volume" value={`${props.totalVolumeLbs.toLocaleString()} lbs`} />
            <Stat label="Exercises" value={props.exerciseCount.toString()} />
          </div>
          {props.muscleGroups.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {props.muscleGroups.slice(0, 6).map(([m]) => (
                <span
                  key={m}
                  className="rounded-full bg-white/15 px-2 py-0.5 text-xs"
                >
                  {m}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {props.prCount > 0 ? (
              <span className="rounded-full bg-yellow-400/20 text-yellow-300 px-2.5 py-1 text-xs font-semibold">
                🏆 {props.prCount} PR{props.prCount !== 1 ? "s" : ""}
              </span>
            ) : null}
            {props.streakDays > 0 ? (
              <span className="rounded-full bg-orange-400/20 text-orange-300 px-2.5 py-1 text-xs font-semibold">
                🔥 {props.streakDays} day streak
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleNativeShare}
            disabled={busy}
            className="h-11"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            <span className="ml-2">Share</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="h-11"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-2">{copied ? "Copied" : "Copy text"}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}
