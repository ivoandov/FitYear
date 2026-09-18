import { describe, it, expect } from "vitest";
import { IMAGE_SUBJECTS, imageSubjectFor } from "@/lib/image-subjects";

describe("the subject line of an exercise image prompt", () => {
  it("uses the correction for an exercise whose image was seen to be wrong", () => {
    const line = imageSubjectFor("Dumbbell Standing Shoulder Press", "Press the weight overhead.");
    expect(line).toContain("one dumbbell in each hand");
    // The correction REPLACES the description: that text is written for a
    // person reading the exercise page, not for drawing it.
    expect(line).not.toContain("Press the weight overhead.");
  });

  it("leaves every other exercise on its name and description", () => {
    // The 2026-09-18 experiment: briefing every exercise broke ones the bare
    // name had drawn correctly. Only proven-wrong images get a correction.
    expect(imageSubjectFor("Nordic Hamstring Curls", "Kneel and lower.")).toBe(
      "Subject: Nordic Hamstring Curls. Kneel and lower.",
    );
    expect(imageSubjectFor("Nordic Hamstring Curls", null)).toBe("Subject: Nordic Hamstring Curls.");
  });

  it("keeps every correction free of em dashes and short enough not to crowd out the style", () => {
    for (const [name, subject] of Object.entries(IMAGE_SUBJECTS)) {
      expect(subject, name).not.toMatch(/[–—]/);
      expect(subject.split(/\s+/).length, name).toBeLessThanOrEqual(50);
    }
  });
});
