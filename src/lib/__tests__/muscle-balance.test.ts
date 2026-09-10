import { describe, it, expect } from "vitest";
import {
  judgeGroup,
  rankGroups,
  balanceHeadline,
  STALE_DAYS,
  type GroupActivity,
} from "@/lib/muscle-balance";
import type { CoarseGroup } from "@/lib/muscle-groups";

const a = (group: CoarseGroup, daysSince: number | null, sets7 = 0, baselineWeekly = 0): GroupActivity =>
  ({ group, daysSince, sets7, baselineWeekly });

describe("judgeGroup", () => {
  it("calls a long absence behind", () => {
    const v = judgeGroup(a("Back", STALE_DAYS));
    expect(v.status).toBe("behind");
    expect(v.reason).toContain("Back");
  });

  it("leaves a group trained yesterday alone", () => {
    const v = judgeGroup(a("Chest", 1, 12, 12));
    expect(v.status).toBe("on-track");
    expect(v.reason).toBeNull();
  });

  it("says never when there is no history at all", () => {
    expect(judgeGroup(a("Legs", null)).status).toBe("never");
  });

  it("measures a shortfall against the USER'S OWN norm, not an ideal", () => {
    // 4 sets this week against a usual 16 is a real drop.
    expect(judgeGroup(a("Legs", 6, 4, 16)).status).toBe("behind");
    // The same 4 sets is fine for somebody whose norm IS 4.
    expect(judgeGroup(a("Legs", 6, 4, 4)).status).not.toBe("behind");
  });

  it("does not invent a norm from too little history", () => {
    // baselineWeekly below the minimum: no shortfall claim can be made.
    const v = judgeGroup(a("Forearms", 6, 0, 0.5));
    expect(v.status).not.toBe("behind");
  });

  it("marks a rested group as due rather than behind", () => {
    const v = judgeGroup(a("Shoulders", 5, 10, 10));
    expect(v.status).toBe("due");
  });

  it("never nudges Cardio or PT", () => {
    // Somebody with no PT logged does not have an injury, not a problem.
    expect(judgeGroup(a("PT", null)).status).toBe("on-track");
    expect(judgeGroup(a("Cardio", 90)).status).toBe("on-track");
    expect(judgeGroup(a("Cardio", 90)).reason).toBeNull();
  });
});

describe("rankGroups", () => {
  it("puts the worst first and the longest-neglected first within a status", () => {
    const ranked = rankGroups([
      a("Chest", 1, 12, 12),
      a("Back", 14),
      a("Legs", 30),
      a("Biceps", null),
    ]);
    expect(ranked[0].group).toBe("Biceps"); // never beats behind
    expect(ranked[1].group).toBe("Legs"); // 30 days beats 14
    expect(ranked[2].group).toBe("Back");
    expect(ranked[ranked.length - 1].group).toBe("Chest");
  });

  it("is stable when two groups are equally neglected", () => {
    const once = rankGroups([a("Triceps", 12), a("Biceps", 12)]).map((v) => v.group);
    const twice = rankGroups([a("Biceps", 12), a("Triceps", 12)]).map((v) => v.group);
    expect(once).toEqual(twice);
  });
});

describe("balanceHeadline", () => {
  it("says nothing when nothing is wrong", () => {
    // A card that shows up every day stops being read on the day it matters.
    expect(balanceHeadline(rankGroups([a("Chest", 1, 12, 12)]))).toBeNull();
  });

  it("names one, two, or two and a count", () => {
    expect(balanceHeadline(rankGroups([a("Back", 14)]))).toBe("Back is behind.");
    expect(balanceHeadline(rankGroups([a("Back", 14), a("Legs", 20)]))).toBe(
      "Legs and Back are behind.",
    );
    const many = rankGroups([a("Back", 14), a("Legs", 20), a("Chest", 16), a("Biceps", 12)]);
    expect(balanceHeadline(many)).toBe("Legs, Chest and 2 more are behind.");
  });
});
