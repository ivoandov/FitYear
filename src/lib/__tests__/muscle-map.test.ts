import { describe, it, expect } from "vitest";
import { muscleMapLoads, regionsFor } from "@/lib/muscle-map";

describe("which regions an exercise trained", () => {
  it("lights only the named muscle when a specific is tagged alongside its group", () => {
    // A leg extension tagged Legs + Quads did not train the calves.
    expect([...regionsFor(["Legs", "Quads"])]).toEqual(["quadriceps"]);
  });

  it("falls back to the whole group when only the group is tagged", () => {
    expect(regionsFor(["Legs"])).toEqual(
      new Set(["quadriceps", "hamstring", "gluteal", "calves", "adductors"]),
    );
  });

  it("keeps other groups broad when only one group names a specific", () => {
    expect(regionsFor(["Chest", "Shoulders", "Front Delts", "Triceps"])).toEqual(
      new Set(["chest", "deltoids", "triceps"]),
    );
  });

  it("draws nothing for Cardio or PT, which are not muscles", () => {
    expect(regionsFor(["Cardio", "Knee PT"]).size).toBe(0);
  });

  it("resolves the app's synonyms and case like every other surface", () => {
    expect(regionsFor(["quadriceps", "HAMSTRINGS"])).toEqual(new Set(["quadriceps", "hamstring"]));
  });
});

describe("loads for a whole workout", () => {
  it("credits an exercise ONCE per region, however many tags land there", () => {
    // Lats and Upper Back both map to the upper back; 4 sets is 4, not 8.
    const [load] = muscleMapLoads([{ muscleGroups: ["Lats", "Upper Back"], completedSets: 4 }]).filter(
      (l) => l.slug === "upper-back",
    );
    expect(load.sets).toBe(4);
  });

  it("sums sets across exercises and ranks intensity against the busiest region", () => {
    const loads = muscleMapLoads([
      { muscleGroups: ["Chest"], completedSets: 4 },
      { muscleGroups: ["Chest", "Triceps"], completedSets: 3 },
      { muscleGroups: ["Biceps"], completedSets: 2 },
    ]);
    expect(loads).toEqual([
      { slug: "chest", sets: 7, intensity: 3 },
      { slug: "triceps", sets: 3, intensity: 2 },
      { slug: "biceps", sets: 2, intensity: 1 },
    ]);
  });

  it("ignores an exercise with no completed sets", () => {
    // Opening an exercise prefills rows; only completed sets trained anything.
    expect(muscleMapLoads([{ muscleGroups: ["Chest"], completedSets: 0 }])).toEqual([]);
  });
});
