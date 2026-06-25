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
  prs: Array<{
    exerciseName: string;
    type: "weight" | "volume";
    newValue: number;
    previousValue: number | null;
  }>;
  streakDays: number;
}

// 9:16 portrait share card. Rendered at this base size, captured at scale 3
// (1080x1920). Matches WEEKLY_TARGET_PER_MUSCLE on the summary page so the
// muscle bars read identically.
const CARD_W = 360;
const CARD_H = 640;
const WEEKLY_TARGET_PER_MUSCLE = 20;

// B+ palette as literals — html2canvas mis-renders Tailwind's oklch/CSS-var
// tokens, so the capture card styles everything inline with explicit colors.
const C = {
  bg: "#0B0B0A",
  surface: "#161614",
  border: "rgba(255,255,255,0.10)",
  primary: "#E5FF00",
  onPrimary: "#0A0A0A",
  primaryDim: "rgba(229,255,0,0.12)",
  primaryBorder: "rgba(229,255,0,0.32)",
  fg: "#F5F5F5",
  muted: "rgba(255,255,255,0.55)",
  track: "rgba(255,255,255,0.08)",
};

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
        backgroundColor: C.bg,
        scale: 3, // 360x640 -> 1080x1920 (9:16)
        useCORS: true,
        width: CARD_W,
        height: CARD_H,
        windowWidth: CARD_W,
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

        {/* Capture target — 9:16 portrait card in the app's B+ theme, mirroring
            the on-screen summary. Centered + scrollable so the tall card fits
            the dialog without an ancestor transform (which would scale the
            html2canvas output). */}
        <div className="flex justify-center max-h-[64vh] overflow-y-auto">
          <div
            ref={cardRef}
            style={{
              width: CARD_W,
              height: CARD_H,
              flex: "0 0 auto",
              boxSizing: "border-box",
              padding: "28px 24px 22px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              color: C.fg,
              fontFamily:
                "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
              background: `radial-gradient(120% 55% at 50% 0%, rgba(229,255,0,0.10) 0%, rgba(229,255,0,0) 46%), ${C.bg}`,
              borderRadius: 24,
            }}
          >
            {/* Wordmark */}
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 3,
                color: C.primary,
                textAlign: "center",
              }}
            >
              FITYEAR
            </div>

            {/* Trophy + name + date + streak */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  background: C.primaryDim,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                }}
              >
                🏆
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.15 }}>
                {props.workoutName}
              </div>
              <div style={{ fontSize: 12, color: C.muted }}>{props.date}</div>
              {props.streakDays > 0 ? (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    background: C.primaryDim,
                    color: C.primary,
                    borderRadius: 999,
                    padding: "3px 10px",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  🔥 {props.streakDays} day streak
                </div>
              ) : null}
            </div>

            {/* 2x2 stats */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <StatBox label="Duration" value={props.durationLabel} />
              <StatBox label="Sets" value={String(props.totalSets)} />
              <StatBox
                label="Volume"
                value={`${props.totalVolumeLbs.toLocaleString()} lbs`}
              />
              <StatBox label="Exercises" value={String(props.exerciseCount)} />
            </div>

            {/* Muscles trained (bars, like the summary) */}
            {props.muscleGroups.length > 0 ? (
              <div
                style={{
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  borderRadius: 14,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 9,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Muscles trained
                </div>
                {props.muscleGroups.slice(0, 5).map(([muscle, sets]) => {
                  const pct = Math.min(
                    100,
                    Math.round((sets / WEEKLY_TARGET_PER_MUSCLE) * 100),
                  );
                  return (
                    <div key={muscle} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 12,
                        }}
                      >
                        <span>{muscle}</span>
                        <span style={{ color: C.muted }}>{sets} sets</span>
                      </div>
                      <div
                        style={{
                          height: 7,
                          borderRadius: 999,
                          background: C.track,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: C.primary,
                            borderRadius: 999,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Personal bests */}
            {props.prs.length > 0 ? (
              <div
                style={{
                  border: `1px solid ${C.primaryBorder}`,
                  background: "rgba(229,255,0,0.05)",
                  borderRadius: 14,
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 7,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>
                  🏆 {props.prs.length} new personal best
                  {props.prs.length !== 1 ? "s" : ""}
                </div>
                {props.prs.slice(0, 3).map((pr, i) => (
                  <div
                    key={`${pr.exerciseName}-${pr.type}-${i}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      gap: 8,
                    }}
                  >
                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {pr.exerciseName}
                    </span>
                    <span style={{ color: C.muted, whiteSpace: "nowrap" }}>
                      {pr.type === "weight"
                        ? `${pr.newValue} lbs`
                        : `${pr.newValue.toLocaleString()} vol`}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Footer */}
            <div
              style={{
                marginTop: "auto",
                textAlign: "center",
                fontSize: 11,
                color: C.muted,
                letterSpacing: 0.4,
              }}
            >
              Tracked with FitYear
            </div>
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

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: C.surface,
        borderRadius: 12,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: C.muted,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
