import { describe, it, expect } from "vitest";
import { restOngoingContent, REST_NOTIFICATION_TAG } from "@/lib/rest-notification";

// Fixed local wall-clock time so the formatted output is deterministic.
const END = new Date(2026, 7, 25, 18, 42, 0).getTime();

describe("restOngoingContent", () => {
  it("states the finish TIME, never a countdown", () => {
    // The text cannot re-render while the app is suspended, so a frozen
    // "1:30 left" would be wrong within seconds. This is the whole reason the
    // copy is written around an absolute time.
    const { title, body } = restOngoingContent({ endTimeMs: END, exerciseName: "Bench Press" });
    expect(title).toMatch(/^Resting until /);
    expect(title).toMatch(/6:42|18:42/);
    expect(title).not.toMatch(/left|remaining|\d+s\b/);
    expect(body).toBe("After Bench Press");
  });

  it("leads with the next exercise when there is one", () => {
    const { body } = restOngoingContent({
      endTimeMs: END,
      exerciseName: "Bench Press",
      nextExerciseName: "Incline Press",
    });
    expect(body).toBe("Up next: Incline Press");
  });

  it("falls back to a neutral line when there is no useful exercise name", () => {
    expect(restOngoingContent({ endTimeMs: END }).body).toBe("Tap when you're back.");
    // "Rest" is the generic placeholder name, not a real exercise.
    expect(restOngoingContent({ endTimeMs: END, exerciseName: "Rest" }).body).toBe(
      "Tap when you're back.",
    );
    expect(restOngoingContent({ endTimeMs: END, exerciseName: "   " }).body).toBe(
      "Tap when you're back.",
    );
  });

  it("shares the completion alert's tag so the finish alert replaces it", () => {
    // sw.js posts the "Rest Complete" push under this same tag on purpose.
    expect(REST_NOTIFICATION_TAG).toBe("rest-timer");
  });
});
