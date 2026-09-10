import { describe, it, expect } from "vitest";
import { familyOf, countsTowardGoal } from "@/lib/exercise-family";

describe("familyOf", () => {
  it("catches every push-up spelling the catalog actually contains", () => {
    // History keeps its own name snapshot, so older rows carry whatever they
    // were called before canonicalisation settled on "Push-ups".
    for (const n of ["Push-ups", "Pushups", "Push Ups", "Push-Up", "Knee Push-ups", "Parallettes Deficit Push-ups"]) {
      expect(familyOf(n), n).toBe("push-up");
    }
  });

  it("puts chin-ups in the pull-up family", () => {
    // Ivo's call, and the right one: same movement, different grip.
    for (const n of ["Pull-ups", "Chin-ups", "Assisted Pull-ups", "Explosive Chest to Bar Pull-ups", "Neutral Grip Strict Pull-ups Tempo 3-0-1"]) {
      expect(familyOf(n), n).toBe("pull-up");
    }
  });

  it("does NOT match pulldowns, pushdowns or pull-aparts", () => {
    // These are the near-misses that share a word with the family and are a
    // different movement entirely. Every one is real and in the catalog.
    for (const n of [
      "Lat Pulldown",
      "Cable Lat Pulldown",
      "Neutral Grip Lat Pulldown",
      "Lat Pushdown",
      "Cable Rope Pushdowns",
      "Bar Pushdowns",
      "Band Pull Apart",
      "Face Pulls",
      "Cable Pull Through",
      "Neutral Grip Explosive Sternum Pulls",
    ]) {
      expect(familyOf(n), n).toBeNull();
    }
  });

  it("is not fooled by a word that merely contains a family term's prefix", () => {
    // "Machine" contains "chin". The family term is "chinup", which is why
    // these are safe - and why the term must never be loosened to "chin".
    for (const n of ["Machine Chest Fly", "Machine Hamstring Curls", "Machine Shoulder Press"]) {
      expect(familyOf(n), n).toBeNull();
    }
  });

  it("returns null for ordinary exercises", () => {
    for (const n of ["Barbell Bench Press", "Tricep Dips", "Parallel Bar Dips", ""]) {
      expect(familyOf(n), n).toBeNull();
    }
  });
});

describe("countsTowardGoal", () => {
  const pullGoal = { exerciseId: "pull-1", exerciseName: "Pull-ups" };

  it("counts every variation toward a family goal, whatever its catalog id", () => {
    // The whole point: a goal on Pull-ups used to count only that one row.
    for (const name of ["Chin-ups", "Assisted Pull-ups", "Explosive Chest to Bar Pull-ups"]) {
      expect(countsTowardGoal(pullGoal, { id: "some-other-id", name }), name).toBe(true);
    }
  });

  it("does not count a different movement toward a family goal", () => {
    expect(countsTowardGoal(pullGoal, { id: "x", name: "Lat Pulldown" })).toBe(false);
    expect(countsTowardGoal(pullGoal, { id: "x", name: "Push-ups" })).toBe(false);
  });

  it("keeps exact-id matching for a goal with no family", () => {
    // Nothing outside push-ups and pull-ups changes behavior.
    const squat = { exerciseId: "squat-1", exerciseName: "Barbell Back Squat" };
    expect(countsTowardGoal(squat, { id: "squat-1", name: "Barbell Back Squat" })).toBe(true);
    expect(countsTowardGoal(squat, { id: "other", name: "Barbell Back Squat" })).toBe(false);
    expect(countsTowardGoal(squat, { id: "other", name: "Front Squat" })).toBe(false);
  });

  it("matches a family goal even when the logged row has no id", () => {
    // A history snapshot can carry a name without a live catalog id.
    expect(countsTowardGoal(pullGoal, { id: null, name: "Chin-ups" })).toBe(true);
  });
});
