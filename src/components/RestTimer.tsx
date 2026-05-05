"use client";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pause, Play, SkipForward, Minimize2 } from "lucide-react";
import { useTimer } from "@/context/TimerContext";

export function RestTimer() {
  const { isOpen, isMinimized, seconds, isPaused, initialSeconds, exerciseName, nextExerciseName, closeTimer, setIsMinimized, pauseResume } = useTimer();

  const visible = isOpen && !isMinimized;

  const progress = ((initialSeconds - seconds) / initialSeconds) * 100;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const timeString = `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  const circumference = 2 * Math.PI * 120;
  const strokeDashoffset = circumference * (1 - progress / 100);

  return (
    <Dialog open={visible} onOpenChange={(open) => { if (!open) closeTimer(); }}>
      <DialogContent
        className="sm:max-w-md border-0 bg-background/95 backdrop-blur-sm p-0"
        data-testid="dialog-rest-timer"
      >
        <div className="flex flex-col items-center px-6 pt-6 pb-6">
          <h2 className="text-xl font-semibold w-full mb-6" data-testid="text-exercise-name">
            {exerciseName}
          </h2>

          <div className="relative w-64 h-64 flex items-center justify-center mb-8">
            <div className="absolute inset-0 rounded-full bg-[#1a1a1a] border-4 border-[#2a2a2a]" />
            <svg className="absolute inset-0 w-full h-full -rotate-90">
              <circle cx="128" cy="128" r="120" stroke="#2a2a2a" strokeWidth="6" fill="none" />
              <circle
                cx="128"
                cy="128"
                r="120"
                stroke="white"
                strokeWidth="6"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-500 ease-linear"
              />
            </svg>
            <div className="relative z-10 flex flex-col items-center">
              <div className="text-6xl font-bold tracking-tight" data-testid="text-countdown">
                {timeString}
              </div>
              <div className="text-muted-foreground text-sm mt-1">
                {seconds === 0 ? "Rest complete!" : "Minutes"}
              </div>
            </div>
          </div>

          <div className="flex gap-4 w-full">
            <Button
              variant="outline"
              className="flex-1 h-12"
              onClick={pauseResume}
              data-testid="button-pause-timer"
            >
              {isPaused ? (
                <>
                  <Play className="h-5 w-5 mr-2" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-5 w-5 mr-2" />
                  Pause
                </>
              )}
            </Button>
            <Button
              className="flex-1 h-12"
              onClick={closeTimer}
              data-testid="button-skip-timer"
            >
              <SkipForward className="h-5 w-5 mr-2" />
              Next Set
            </Button>
          </div>

          <Button
            variant="ghost"
            className="mt-3 w-full text-muted-foreground"
            onClick={() => setIsMinimized(true)}
            data-testid="button-minimize-timer"
          >
            <Minimize2 className="h-4 w-4 mr-2" />
            Minimize Timer
          </Button>

          {nextExerciseName && (
            <div className="mt-4 w-full p-4 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
              <p className="text-xs text-muted-foreground mb-1">Up Next</p>
              <p className="font-medium">{nextExerciseName}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}