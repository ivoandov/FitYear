import { describe, it, expect } from "vitest";
import {
  expandAnchorLift,
  expandSkeleton,
} from "@/lib/program-progression";
import type { Skeleton } from "@/lib/program-schema";

describe("expandAnchorLift", () => {
  const weekly = expandAnchorLift(
    { scheme: "linear", startLoadLbs: 100, incrementLbs: 5, sets: 3, reps: "5" },
    { durationWeeks: 8, deloadWeeks: [4, 8], deloadLoadFactor: 0.9 },
  );

  it("climbs linearly on working weeks and deloads ~10% lighter", () => {
    expect(weekly.map((p) => p.loadLbs)).toEqual([
      100, 105, 110, 99, 115, 120, 125, 112.5,
    ]);
  });

  it("flags the deload weeks", () => {
    expect(weekly.map((p) => p.isDeload)).toEqual([
      false, false, false, true, false, false, false, true,
    ]);
  });

  it("resumes climbing after a deload rather than resetting", () => {
    // Week 5 (index 4) resumes above week 3 (index 2), not back at the start.
    expect(weekly[4].loadLbs).toBeGreaterThan(weekly[2].loadLbs);
  });

  it("keeps sets/reps fixed in the v1 linear scheme", () => {
    expect(weekly.every((p) => p.sets === 3 && p.reps === "5")).toBe(true);
  });

  it("handles bodyweight anchors (no load) without NaN", () => {
    const bw = expandAnchorLift(
      { scheme: "linear", startLoadLbs: 0, incrementLbs: 0, sets: 3, reps: "AMRAP" },
      { durationWeeks: 3, deloadWeeks: [], deloadLoadFactor: 0.9 },
    );
    expect(bw.map((p) => p.loadLbs)).toEqual([0, 0, 0]);
  });
});

describe("expandSkeleton", () => {
  const skeleton: Skeleton = {
    name: "Test Program",
    durationWeeks: 4,
    daysPerWeek: 1,
    deloadWeeks: [4],
    deloadLoadFactor: 0.9,
    phases: [{ name: "Base", focus: "hypertrophy", startWeek: 1, endWeek: 4 }],
    split: [
      {
        dayLabel: "Full Body",
        dayOfWeek: "Monday",
        muscleGroups: ["Legs"],
        anchorLifts: [
          {
            name: "Back Squat",
            muscleGroups: ["Legs"],
            exerciseType: "weight_reps",
            isAssisted: false,
            progression: {
              scheme: "linear",
              startLoadLbs: 100,
              incrementLbs: 5,
              sets: 3,
              reps: "5",
            },
          },
        ],
      },
    ],
  };

  it("attaches per-week prescriptions to each anchor and preserves its metadata", () => {
    const anchor = expandSkeleton(skeleton).split[0].anchors[0];
    expect(anchor.name).toBe("Back Squat");
    expect(anchor.weekly.map((p) => p.loadLbs)).toEqual([100, 105, 110, 99]);
    // progression config is consumed, not carried onto the expanded anchor
    expect((anchor as unknown as Record<string, unknown>).progression).toBeUndefined();
  });
});
