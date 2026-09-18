import { describe, it, expect } from "vitest";
import { demoVideoIdFor, withoutDashes } from "@/lib/api/exercise-enrich";

describe("stripping dashes from a generated cue", () => {
  it("replaces an em dash with a comma", () => {
    // Em dashes are a hard house rule and cues are rendered in the app, on the
    // tracker mid-set and on the exercise detail page. The prompt asks the
    // model to avoid them; this is the backstop, because a prompt is a request.
    expect(withoutDashes("Dead stop every rep — let the bar settle")).toBe(
      "Dead stop every rep, let the bar settle",
    );
  });

  it("replaces an en dash too", () => {
    expect(withoutDashes("Knee stays put – only the ankle moves")).toBe(
      "Knee stays put, only the ankle moves",
    );
  });

  it("leaves an ordinary hyphen alone", () => {
    // A hyphen is legitimate punctuation and appears in real exercise language.
    // Sweeping it away is exactly the bug that once turned "Y-T-W" into "Y T W".
    expect(withoutDashes("Drive the pinky-toe edge out and up")).toBe(
      "Drive the pinky-toe edge out and up",
    );
  });

  it("does not leave a space before the comma it inserts", () => {
    expect(withoutDashes("Chest up — back flat")).not.toMatch(/\s,/);
  });

  it("leaves a clean cue untouched", () => {
    const clean = "Elbows at 45, not flared";
    expect(withoutDashes(clean)).toBe(clean);
  });
});

describe("attaching a demonstration video on create", () => {
  it("finds the video for a name the vocabulary knows", async () => {
    // The whole point: the Add Exercise autocomplete suggests this name, so
    // adding it must carry the hand-picked demonstration across rather than
    // leaving the id sitting unused in the repo.
    await expect(demoVideoIdFor("Barbell Pendlay Row")).resolves.toMatch(
      /^[A-Za-z0-9_-]{6,}$/,
    );
  });

  it("returns null for a movement nothing has a video for", async () => {
    await expect(demoVideoIdFor("Band Ankle Eversion")).resolves.toBeNull();
  });

  it("returns null rather than throwing on nonsense", async () => {
    await expect(demoVideoIdFor("")).resolves.toBeNull();
    await expect(demoVideoIdFor("Qwertyuiop Asdfghjkl")).resolves.toBeNull();
  });
});
