import { describe, it, expect } from "vitest";
import {
  resolveWorkoutDuration,
  formatDuration,
  parseDurationInput,
  IDLE_TRIM_THRESHOLD_SECONDS,
} from "@/lib/workout-duration";

const START = Date.parse("2026-08-25T17:00:00Z");
const at = (mins: number) => new Date(START + mins * 60_000);
const msAt = (mins: number) => START + mins * 60_000;

describe("resolveWorkoutDuration", () => {
  it("returns null with no start time (legacy rows)", () => {
    const r = resolveWorkoutDuration({ startedAt: null, completedAt: at(60) });
    expect(r.durationSeconds).toBeNull();
    expect(r.trimmed).toBe(false);
  });

  it("uses the raw span when there is no activity stamp", () => {
    const r = resolveWorkoutDuration({ startedAt: at(0), completedAt: at(65) });
    expect(r.durationSeconds).toBe(65 * 60);
    expect(r.trimmed).toBe(false);
  });

  it("leaves a normal session alone when the user finishes promptly", () => {
    const r = resolveWorkoutDuration({
      startedAt: at(0),
      completedAt: at(62),
      lastActivityAt: msAt(61),
    });
    expect(r.durationSeconds).toBe(62 * 60);
    expect(r.trimmed).toBe(false);
  });

  // Ivo's actual complaint: trained for an hour, pressed Finish four hours later.
  it("trims the idle tail when Finish was pressed hours after the last set", () => {
    const r = resolveWorkoutDuration({
      startedAt: at(0),
      completedAt: at(240),
      lastActivityAt: msAt(60),
    });
    expect(r.durationSeconds).toBe(60 * 60);
    expect(r.rawSeconds).toBe(240 * 60);
    expect(r.trimmed).toBe(true);
  });

  it("does not trim a long but plausible gap just under the threshold", () => {
    const justUnder = IDLE_TRIM_THRESHOLD_SECONDS - 60;
    const r = resolveWorkoutDuration({
      startedAt: at(0),
      completedAt: new Date(msAt(60) + justUnder * 1000),
      lastActivityAt: msAt(60),
    });
    expect(r.trimmed).toBe(false);
  });

  it("trims exactly at the threshold", () => {
    const r = resolveWorkoutDuration({
      startedAt: at(0),
      completedAt: new Date(msAt(60) + IDLE_TRIM_THRESHOLD_SECONDS * 1000),
      lastActivityAt: msAt(60),
    });
    expect(r.trimmed).toBe(true);
    expect(r.durationSeconds).toBe(60 * 60);
  });

  it("ignores a nonsensical activity stamp rather than trusting it", () => {
    // Before the start (a restored older blob).
    expect(
      resolveWorkoutDuration({ startedAt: at(10), completedAt: at(70), lastActivityAt: msAt(5) }).trimmed,
    ).toBe(false);
    // After the finish (clock skew).
    expect(
      resolveWorkoutDuration({ startedAt: at(0), completedAt: at(60), lastActivityAt: msAt(90) }).trimmed,
    ).toBe(false);
  });

  it("never returns a negative duration", () => {
    const r = resolveWorkoutDuration({ startedAt: at(60), completedAt: at(0) });
    expect(r.durationSeconds).toBe(0);
  });
});

describe("formatDuration", () => {
  it.each([
    [null, ""],
    [undefined, ""],
    [-5, ""],
    [45, "45s"],
    [60, "1m"],
    [48 * 60, "48m"],
    [60 * 60, "1h"],
    [72 * 60, "1h 12m"],
    [125 * 60, "2h 5m"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatDuration(input as number | null | undefined)).toBe(expected);
  });
});

describe("parseDurationInput", () => {
  it.each([
    ["72", 72 * 60], // bare number = minutes, how people say it
    ["48m", 48 * 60],
    ["1h", 3600],
    ["1h 12m", 72 * 60],
    ["1h12m", 72 * 60],
    ["1:12", 72 * 60],
    ["2:05", 125 * 60],
    ["1.5h", 90 * 60],
  ])("parses %s", (input, expected) => {
    expect(parseDurationInput(input)).toBe(expected);
  });

  it.each(["", "   ", "abc", "banana"])("rejects %s", (input) => {
    expect(parseDurationInput(input)).toBeNull();
  });
});
