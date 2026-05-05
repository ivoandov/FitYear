"use client";

import { Button } from "@/components/ui/button";
import { Pause, Play, SkipForward, Maximize2 } from "lucide-react";
import { useTimer } from "@/context/TimerContext";

export function FloatingTimerPill() {
  const { isOpen, isMinimized, seconds, isPaused, initialSeconds, setIsMinimized, pauseResume, closeTimer } = useTimer();

  if (!isOpen || !isMinimized) return null;

  const progress = ((initialSeconds - seconds) / initialSeconds) * 100;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const timeString = `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;

  const pillCircumference = 2 * Math.PI * 16;
  const pillOffset = pillCircumference * (1 - progress / 100);

  return (
    <div
      className="fixed bottom-20 right-4 z-[9999] flex items-center gap-2 bg-background border border-border rounded-full shadow-lg px-3 py-2 cursor-pointer hover-elevate"
      onClick={() => setIsMinimized(false)}
      data-testid="pill-rest-timer-minimized"
    >
      {/* Mini circular progress */}
      <div className="relative w-9 h-9 flex items-center justify-center flex-shrink-0">
        <svg className="absolute inset-0 w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="16" stroke="hsl(var(--muted))" strokeWidth="2.5" fill="none" />
          <circle
            cx="18"
            cy="18"
            r="16"
            stroke="hsl(var(--primary))"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={pillCircumference}
            strokeDashoffset={pillOffset}
            className="transition-all duration-500 ease-linear"
          />
        </svg>
        <span className="relative z-10 text-[10px] font-bold leading-none">
          {seconds === 0 ? "✓" : minutes > 0 ? `${minutes}m` : `${remainingSeconds}s`}
        </span>
      </div>

      {/* Time display */}
      <span className="text-sm font-semibold tabular-nums" data-testid="text-pill-countdown">
        {seconds === 0 ? "Done!" : timeString}
      </span>

      {/* Pause/Play */}
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 flex-shrink-0"
        onClick={(e) => { e.stopPropagation(); pauseResume(); }}
        data-testid="button-pill-pause-resume"
      >
        {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      </Button>

      {/* Skip */}
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 flex-shrink-0"
        onClick={(e) => { e.stopPropagation(); closeTimer(); }}
        data-testid="button-pill-skip"
      >
        <SkipForward className="h-3.5 w-3.5" />
      </Button>

      <Maximize2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
    </div>
  );
}