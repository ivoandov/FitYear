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
  // Whether the USER still wants to be dictating. The engine ends a session on
  // its own after a pause even with `continuous` set, so this is what tells an
  // automatic end (restart it) apart from a deliberate stop (leave it alone).
  const wantRef = useRef(false);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionCtor;
      webkitSpeechRecognition?: RecognitionCtor;
    };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      wantRef.current = false;
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
    // Keep listening across pauses. It used to be false, which ends the session
    // at the first breath: dictating a long instruction captured the opening
    // few words and silently stopped, which reads exactly like the app losing
    // the rest of the sentence.
    rec.continuous = true;
    // Snapshot the field so speech appends to (not replaces) what's typed.
    baseRef.current = value ? value.trimEnd() : "";
    rec.onresult = (e) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
      heard = heard.trim();
      if (!heard) return;
      onChange(baseRef.current ? `${baseRef.current} ${heard}` : heard);
    };
    rec.onend = () => {
      // An engine-initiated end while the user still holds the mic open: fold
      // what was heard into the base and start a fresh session, so a long
      // dictation survives the pauses inside it.
      if (!wantRef.current) {
        setListening(false);
        return;
      }
      try {
        rec.start();
      } catch {
        wantRef.current = false;
        setListening(false);
      }
    };
    rec.onerror = () => {
      wantRef.current = false;
      setListening(false);
    };
    recRef.current = rec;
    try {
      wantRef.current = true;
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
      setListening(false);
    }
  };

  const stop = () => {
    wantRef.current = false;
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
