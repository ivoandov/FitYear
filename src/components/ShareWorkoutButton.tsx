"use client";

import { useRef, useState } from "react";
import { Share2, Loader2, Copy, Check, Download } from "lucide-react";
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
  exercises?: Array<{ name: string; sets: number; reps: number | null }>;
}

// 9:16 portrait share card. Rendered at this base size, captured at scale 3
// (1080x1920). Matches WEEKLY_TARGET_PER_MUSCLE on the summary page so the
// muscle bars read identically.
const CARD_W = 360;
const CARD_H = 640;
const WEEKLY_TARGET_PER_MUSCLE = 20;

// A+ palette as literals - html2canvas mis-renders Tailwind's oklch/CSS-var
// tokens, so the capture card styles everything inline with explicit colors.
const C = {
  bg: "#0B0B0A",
  surface: "#161614",
  border: "rgba(255,255,255,0.08)",
  primary: "#E5FF00",
  onPrimary: "#0A0A0A",
  primaryDim: "rgba(229,255,0,0.12)",
  primaryBorder: "rgba(229,255,0,0.4)",
  fg: "#F5F5F5",
  muted: "#A3A3A3",
  tertiary: "#6B6B6B",
  exText: "#D8D8D6",
  track: "rgba(255,255,255,0.08)",
  success: "#57C98A",
};
// Reference the loaded mono via the CSS var (font-family strings are read from
// computed style by html2canvas - unlike oklch colors, they capture fine).
const MONO = "var(--font-mono), ui-monospace, monospace";

// html2canvas clips the ascenders of text inside an `overflow:hidden` box
// (regardless of line-height), so the capture card truncates long labels in JS
// rather than with CSS ellipsis - no overflow-clip means nothing to mis-crop.
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
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

  async function handleSaveImage() {
    setBusy(true);
    try {
      const blob = await captureAsBlob();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "fityear-workout.png";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* no-op */
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
          aria-label="Share workout"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-strong bg-white/[0.04] text-foreground hover:bg-white/[0.08]"
        >
          <Share2 className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        {/* Sheet grabber */}
        <div className="mx-auto -mt-1 h-1 w-9 rounded-full bg-white/[0.18]" />
        <div className="space-y-1 text-center">
          <DialogTitle className="text-center text-[17px]">
            Share your workout
          </DialogTitle>
          <DialogDescription className="text-center">
            A 1080 × 1920 story image, ready to post
          </DialogDescription>
        </div>

        {/* Capture target - the true 9:16 export card (rendered at full base size
            so html2canvas outputs 1080×1920). Centered + scrollable so it fits
            the sheet without an ancestor transform (which would scale the
            capture output). All styling is literal hex, never token classes. */}
        <div className="flex max-h-[52vh] justify-center overflow-y-auto">
          <div
            ref={cardRef}
            style={{
              width: CARD_W,
              height: CARD_H,
              flex: "0 0 auto",
              position: "relative",
              overflow: "hidden",
              boxSizing: "border-box",
              padding: "18px 20px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              color: C.fg,
              fontFamily:
                "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
              background: `radial-gradient(115% 40% at 50% 0%, rgba(229,255,0,0.16) 0%, rgba(229,255,0,0) 50%), ${C.bg}`,
              borderRadius: 20,
            }}
          >
            {/* confetti */}
            <div style={{ position: "absolute", top: 40, left: 40, width: 8, height: 8, borderRadius: 2, background: C.primary, transform: "rotate(20deg)" }} />
            <div style={{ position: "absolute", top: 66, right: 44, width: 8, height: 8, borderRadius: 999, background: "#fff", opacity: 0.6 }} />
            <div style={{ position: "absolute", top: 100, left: 52, width: 6, height: 6, borderRadius: 999, background: C.primary }} />
            <div style={{ position: "absolute", top: 50, right: 72, width: 7, height: 7, borderRadius: 2, background: C.success, transform: "rotate(35deg)" }} />

            {/* Header - wordmark + date */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: 999, background: C.primary }} />
                <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: 3, color: C.primary }}>
                  FITYEAR
                </span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: C.tertiary, whiteSpace: "nowrap" }}>
                {props.date.toUpperCase()}
              </span>
            </div>

            {/* Hero - trophy + name + streak */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 999,
                  background: C.primaryDim,
                  border: `1.5px solid ${C.primaryBorder}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: C.primary,
                  boxShadow: "0 0 40px -6px rgba(229,255,0,0.4)",
                }}
              >
                <TrophySvg size={21} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: C.primary }}>
                Workout complete
              </div>
              <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                {props.workoutName}
              </div>
              {props.streakDays > 0 ? (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    background: C.primaryDim,
                    border: `1px solid rgba(229,255,0,0.3)`,
                    color: C.primary,
                    borderRadius: 999,
                    padding: "3px 11px",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <FlameSvg size={12} />
                  <span style={{ fontFamily: MONO }}>{props.streakDays}</span> DAY STREAK
                </div>
              ) : null}
            </div>

            {/* 2x2 stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <StatBox label="Duration" value={props.durationLabel} />
              <StatBox
                label="Volume"
                value={`${props.totalVolumeLbs.toLocaleString()} lb`}
                accent
              />
              <StatBox label="Sets" value={String(props.totalSets)} />
              <StatBox label="Exercises" value={String(props.exerciseCount)} />
            </div>

            {/* PR band - the one bold neon moment: solid neon, black text */}
            {props.prs.length > 0 ? (
              <div
                style={{
                  background: "linear-gradient(180deg,#f0ff5c,#E5FF00)",
                  borderRadius: 15,
                  padding: "11px 14px",
                }}
              >
                <div style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: C.onPrimary, opacity: 0.7, marginBottom: 7 }}>
                  {props.prs.length} New personal best{props.prs.length !== 1 ? "s" : ""}
                </div>
                {props.prs.slice(0, 3).map((pr, i) => (
                  <div key={`${pr.exerciseName}-${pr.type}-${i}`}>
                    {i > 0 ? (
                      <div style={{ height: 1, background: "rgba(10,10,10,0.15)", margin: "6px 0" }} />
                    ) : null}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 14, lineHeight: 1.3, fontWeight: 700, color: C.onPrimary, whiteSpace: "nowrap" }}>
                        {truncate(pr.exerciseName, 22)}
                      </span>
                      <span style={{ fontFamily: MONO, fontSize: 14, lineHeight: 1.3, fontWeight: 700, color: C.onPrimary, whiteSpace: "nowrap", flexShrink: 0 }}>
                        {pr.type === "weight"
                          ? `${pr.newValue} lb`
                          : `${pr.newValue.toLocaleString()} vol`}
                      </span>
                    </div>
                  </div>
                ))}
                {props.prs.length > 3 ? (
                  <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.onPrimary, opacity: 0.6, marginTop: 7 }}>
                    +{props.prs.length - 3} more
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Muscles trained */}
            {props.muscleGroups.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.tertiary }}>
                  Muscles trained
                </div>
                {props.muscleGroups.slice(0, 3).map(([muscle, sets]) => {
                  const pct = Math.min(
                    100,
                    Math.round((sets / WEEKLY_TARGET_PER_MUSCLE) * 100),
                  );
                  return (
                    <div key={muscle} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: C.fg }}>{muscle}</span>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: C.tertiary }}>
                          {sets} sets
                        </span>
                      </div>
                      <div style={{ height: 5, borderRadius: 999, background: C.track, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: C.primary, borderRadius: 999 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Footer */}
            <div style={{ marginTop: "auto", textAlign: "center", fontFamily: MONO, fontSize: 10, letterSpacing: 2, textTransform: "uppercase", color: C.tertiary }}>
              Tracked with FitYear
            </div>
          </div>
        </div>

        {/* Primary Share CTA */}
        <button
          type="button"
          onClick={handleNativeShare}
          disabled={busy}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#f0ff5c,#E5FF00)] text-base font-bold text-primary-foreground shadow-cta-strong disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-[19px] w-[19px]" />}
          Share
        </button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveImage}
            disabled={busy}
            className="h-12"
          >
            <Download className="h-4 w-4" />
            <span className="ml-2">Save image</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            className="h-12"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-2">{copied ? "Copied" : "Copy text"}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        background: C.surface,
        borderRadius: 13,
        padding: "8px 11px",
      }}
    >
      <div
        style={{
          fontFamily: MONO,
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: C.tertiary,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: accent ? C.primary : C.fg }}>
        {value}
      </div>
    </div>
  );
}

// Literal-hex SVGs (lucide paths) so the capture card never depends on token
// colors - currentColor is set inline on the wrapper.
function TrophySvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function FlameSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
