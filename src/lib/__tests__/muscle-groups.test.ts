import { describe, it, expect } from "vitest";
import {
  COARSE_MUSCLE_GROUPS,
  resolveMuscle,
  normalizeMuscleGroups,
  coarseGroupsOf,
  nestedMuscleGroups,
  muscleSubtitle,
  matchesCoarse,
  unmatchedMuscles,
} from "@/lib/muscle-groups";

describe("resolveMuscle", () => {
  it("resolves a coarse group case-insensitively", () => {
    expect(resolveMuscle("back")).toEqual({ label: "Back", coarse: "Back" });
    expect(resolveMuscle("  SHOULDERS ")).toEqual({ label: "Shoulders", coarse: "Shoulders" });
  });

  it("keeps a specific and rolls it up to its coarse", () => {
    expect(resolveMuscle("brachialis")).toEqual({ label: "Brachialis", coarse: "Biceps" });
    expect(resolveMuscle("Rear Delts")).toEqual({ label: "Rear Delts", coarse: "Shoulders" });
    expect(resolveMuscle("glutes")).toEqual({ label: "Glutes", coarse: "Legs" });
  });

  it("maps junk/verbatim strings to a coarse group", () => {
    expect(resolveMuscle("cardiovascular system")).toEqual({ label: "Cardio", coarse: "Cardio" });
    expect(resolveMuscle("thoracic spine")).toEqual({ label: "Back", coarse: "Back" });
    expect(resolveMuscle("hips")).toEqual({ label: "Legs", coarse: "Legs" });
    expect(resolveMuscle("core")).toEqual({ label: "Abs/Core", coarse: "Abs/Core" });
  });

  it("folds the PT categories into the coarse PT group as specifics", () => {
    expect(resolveMuscle("Knee PT")).toEqual({ label: "Knee PT", coarse: "PT" });
    expect(resolveMuscle("ankle pt")).toEqual({ label: "Ankle PT", coarse: "PT" });
  });

  it("returns null for an unknown string (quarantine)", () => {
    expect(resolveMuscle("left earlobe")).toBeNull();
    expect(resolveMuscle("")).toBeNull();
  });
});

describe("normalizeMuscleGroups", () => {
  it("normalizes case, de-dupes, and drops unmatched", () => {
    expect(normalizeMuscleGroups(["back", "Back", "left earlobe"])).toEqual(["Back"]);
    expect(normalizeMuscleGroups(["biceps", "brachialis"])).toEqual(["Biceps", "Brachialis"]);
  });

  it("preserves specifics (lossless)", () => {
    expect(normalizeMuscleGroups(["Legs", "glutes", "hamstrings"])).toEqual([
      "Legs",
      "Glutes",
      "Hamstrings",
    ]);
  });
});

describe("coarseGroupsOf", () => {
  it("rolls specifics up to coarse, in fixed coarse order", () => {
    // input order shuffled; output must follow COARSE order (Chest before Legs)
    expect(coarseGroupsOf(["Glutes", "Brachialis", "Chest"])).toEqual([
      "Chest",
      "Biceps",
      "Legs",
    ]);
  });
});

describe("nestedMuscleGroups + muscleSubtitle", () => {
  it("nests specifics under their coarse group", () => {
    expect(nestedMuscleGroups(["Legs", "Glutes", "Hamstrings"])).toEqual([
      { coarse: "Legs", specifics: ["Glutes", "Hamstrings"] },
    ]);
  });

  it("renders 'Coarse (spec, spec)' and bare coarse when no specifics", () => {
    expect(muscleSubtitle(["Legs", "Glutes", "Hamstrings"])).toBe("Legs (Glutes, Hamstrings)");
    expect(muscleSubtitle(["Chest"])).toBe("Chest");
    expect(muscleSubtitle(["Biceps", "Brachialis"])).toBe("Biceps (Brachialis)");
  });

  it("infers the coarse group from a specific even if the coarse isn't tagged", () => {
    // exercise tagged only "Glutes" -> subtitle still anchors on Legs
    expect(muscleSubtitle(["Glutes"])).toBe("Legs (Glutes)");
  });
});

describe("matchesCoarse", () => {
  it("matches an exercise by its coarse rollup", () => {
    expect(matchesCoarse(["Brachialis"], "Biceps")).toBe(true);
    expect(matchesCoarse(["Glutes"], "Legs")).toBe(true);
    expect(matchesCoarse(["Glutes"], "Chest")).toBe(false);
  });
});

describe("unmatchedMuscles", () => {
  it("reports only the strings that don't resolve", () => {
    expect(unmatchedMuscles(["Back", "left earlobe", "glutes"])).toEqual(["left earlobe"]);
  });
});

describe("COARSE_MUSCLE_GROUPS", () => {
  it("is the ratified 10 in fixed anatomical order", () => {
    expect(COARSE_MUSCLE_GROUPS).toEqual([
      "Chest",
      "Back",
      "Shoulders",
      "Biceps",
      "Triceps",
      "Forearms",
      "Abs/Core",
      "Legs",
      "Cardio",
      "PT",
    ]);
  });
});
