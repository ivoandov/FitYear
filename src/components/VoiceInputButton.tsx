"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A dictation button for a text field, on top of the browser's on-device Web
 * Speech API (`webkitSpeechRecognition`). Free, no server, no per-use cost —
 * fits the $0-on-Hobby stance (FITBOT_TECH_SPEC section 1.8). Speech transcribes
 * INTO the field so the user reviews + edits before sending (this matters for
 * accuracy-sensitive instructions like "my knee hurts on X, swap it for Y").
 *
 * Graceful fallback: where the API is unsupported (notably iOS Safari), the
 * button renders nothing at all, so typing always works. First use triggers the
 * browser's mic-permission prompt.
 */
type RecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function VoiceInputButton({
  value,
  onChange,
  disabled,
  tone = "solid",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  tone?: "solid" | "ghost";
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<InstanceType<RecognitionCtor> | null>(null);
  const baseRef = useRef("");

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      try {
        recRef.current?.stop();
      } catch {
        /* ignore */
      }
    };
  }, []);

  if (!supported) return null;

  const start = () => {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    // Snapshot the field so speech appends to (not replaces) what's typed.
    baseRef.current = value ? value.trimEnd() : "";
    rec.onresult = (e) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
      heard = heard.trim();
      if (!heard) return;
      onChange(baseRef.current ? `${baseRef.current} ${heard}` : heard);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const stop = () => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
  };

  return (
    <button
      type="button"
      aria-label={listening ? "Stop dictation" : "Dictate"}
      disabled={disabled}
      onClick={() => (listening ? stop() : start())}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[10px] transition-colors disabled:opacity-40",
        listening
          ? "animate-pulse bg-primary text-primary-foreground"
          : tone === "ghost"
            ? "bg-transparent text-muted-foreground hover:text-foreground"
            : "bg-primary-dim text-primary",
        className,
      )}
    >
      <Mic className="h-[18px] w-[18px]" />
    </button>
  );
}
