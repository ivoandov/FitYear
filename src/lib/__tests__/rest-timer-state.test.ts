import { describe, it, expect } from "vitest";
import {
  decideRestore,
  parseRestTimerState,
  type RestTimerState,
} from "@/lib/rest-timer-state";

const NOW = 1_800_000_000_000;

function blob(partial: Partial<RestTimerState>): string {
  return JSON.stringify({
    endTime: null,
    pausedRemaining: null,
    initialSeconds: 90,
    exerciseName: "Bench Press",
    ...partial,
  });
}

describe("parseRestTimerState", () => {
  it("reads a running timer with its metadata", () => {
    const s = parseRestTimerState(blob({ endTime: NOW + 45_000 }), null, null, NOW);
    expect(s).toEqual({
      endTime: NOW + 45_000,
      pausedRemaining: null,
      initialSeconds: 90,
      exerciseName: "Bench Press",
      nextExerciseName: undefined,
    });
  });

  it("reads a paused timer and keeps the next-exercise label", () => {
    const s = parseRestTimerState(
      blob({ pausedRemaining: 30, nextExerciseName: "Squat" }),
      null,
      null,
      NOW,
    );
    expect(s?.pausedRemaining).toBe(30);
    expect(s?.endTime).toBeNull();
    expect(s?.nextExerciseName).toBe("Squat");
  });

  it("returns null for corrupt, empty, or valueless blobs", () => {
    expect(parseRestTimerState("{not json", null, null, NOW)).toBeNull();
    expect(parseRestTimerState(null, null, null, NOW)).toBeNull();
    expect(parseRestTimerState(blob({}), null, null, NOW)).toBeNull();
    expect(parseRestTimerState(blob({ endTime: 0 }), null, null, NOW)).toBeNull();
  });

  it("falls back to defaults when metadata is missing or junk", () => {
    const s = parseRestTimerState(
      JSON.stringify({ endTime: NOW + 10_000, initialSeconds: "x", exerciseName: 7 }),
      null,
      null,
      NOW,
    );
    expect(s?.initialSeconds).toBe(1);
    expect(s?.exerciseName).toBe("Rest");
  });

  it("migrates the legacy running key, using remaining as the ring's initial", () => {
    const s = parseRestTimerState(null, String(NOW + 40_000), null, NOW);
    expect(s?.endTime).toBe(NOW + 40_000);
    expect(s?.initialSeconds).toBe(40);
    expect(s?.exerciseName).toBe("Rest");
  });

  it("migrates the legacy paused key", () => {
    const s = parseRestTimerState(null, null, "25", NOW);
    expect(s?.pausedRemaining).toBe(25);
    expect(s?.initialSeconds).toBe(25);
  });

  it("prefers the new blob over legacy keys", () => {
    const s = parseRestTimerState(blob({ endTime: NOW + 5_000 }), String(NOW + 99_000), null, NOW);
    expect(s?.endTime).toBe(NOW + 5_000);
  });
});

describe("decideRestore", () => {
  it("reports nothing to restore for null state", () => {
    expect(decideRestore(null, NOW)).toEqual({ status: "none" });
  });

  it("restores a running timer with the remaining seconds", () => {
    const state = parseRestTimerState(blob({ endTime: NOW + 45_000 }), null, null, NOW)!;
    const d = decideRestore(state, NOW);
    expect(d.status).toBe("running");
    expect(d.status === "running" && d.remaining).toBe(45);
  });

  it("treats a rest that ended while the app was away as expired, not complete", () => {
    const state = parseRestTimerState(blob({ endTime: NOW - 60_000 }), null, null, NOW)!;
    expect(decideRestore(state, NOW)).toEqual({ status: "expired" });
  });

  it("expires exactly at zero rather than restoring a 0s timer", () => {
    const state = parseRestTimerState(blob({ endTime: NOW }), null, null, NOW)!;
    expect(decideRestore(state, NOW)).toEqual({ status: "expired" });
  });

  it("restores a paused timer at its frozen remaining", () => {
    const state = parseRestTimerState(blob({ pausedRemaining: 30 }), null, null, NOW)!;
    const d = decideRestore(state, NOW);
    expect(d.status).toBe("paused");
    expect(d.status === "paused" && d.remaining).toBe(30);
  });

  it("does not let a paused timer decay with wall-clock time", () => {
    const state = parseRestTimerState(blob({ pausedRemaining: 30 }), null, null, NOW)!;
    const d = decideRestore(state, NOW + 3_600_000);
    expect(d.status === "paused" && d.remaining).toBe(30);
  });
});
