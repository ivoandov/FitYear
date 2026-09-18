import { describe, it, expect } from "vitest";
import {
  canonicalNameFor,
  referenceSize,
  searchReference,
} from "@/lib/exercise-reference";
import { COARSE_MUSCLE_GROUPS } from "@/lib/muscle-groups";

describe("the reference vocabulary", () => {
  it("is actually populated", () => {
    // A reference list that silently shipped empty would degrade every
    // suggestion to "invent a name" with nothing failing.
    expect(referenceSize()).toBeGreaterThan(800);
  });

  it("speaks FitYear's muscle vocabulary, not the source's", () => {
    // The source says "quadriceps" and "lats"; this app says Legs and Back.
    // Shipping both would hand the model muscle names its own tools never
    // return, which is how two vocabularies end up in one conversation.
    const coarse = new Set<string>(COARSE_MUSCLE_GROUPS);
    for (const e of searchReference({ limit: 60 })) {
      for (const m of [...e.muscles, ...e.secondary]) {
        expect(coarse.has(m)).toBe(true);
      }
    }
  });

  it("finds a movement by name", () => {
    const hits = searchReference({ query: "deadlift" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.name.toLowerCase().includes("deadlift"))).toBe(true);
  });

  it("filters by a coarse muscle group", () => {
    const hits = searchReference({ muscleGroup: "Biceps", limit: 10 });
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every((h) => [...h.muscles, ...h.secondary].includes("Biceps")),
    ).toBe(true);
  });

  it("puts the plainest name first", () => {
    // The source is full of grip and stance variants. Somebody searching
    // "bench press" wants Bench Press, not "Barbell Incline Bench Press Medium
    // Grip", so shorter names sort first.
    const hits = searchReference({ query: "bench press", limit: 5 });
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].name.length).toBeGreaterThanOrEqual(hits[i - 1].name.length);
    }
  });

  it("respects the limit and never returns everything", () => {
    expect(searchReference({ limit: 3 })).toHaveLength(3);
    expect(searchReference({ limit: 9999 }).length).toBeLessThanOrEqual(60);
  });

  it("finds a canonical name for a close spelling", () => {
    const hit = canonicalNameFor("barbell deadlift");
    expect(hit?.name).toBe("Barbell Deadlift");
  });

  it("returns NOTHING rather than a weak guess", () => {
    // Proposing the wrong canonical name is worse than proposing none: the name
    // is what every history snapshot is keyed on, so a bad suggestion
    // permanently mis-files a movement.
    expect(canonicalNameFor("Band Ankle Distraction Floss")).toBeNull();
    expect(canonicalNameFor("")).toBeNull();
  });

  it("carries the classification the app does not store", () => {
    const hit = canonicalNameFor("barbell deadlift");
    expect(hit?.mechanic).toBe("compound");
    expect(hit?.force).toBe("pull");
  });
});
