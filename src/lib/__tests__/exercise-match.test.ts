import { describe, it, expect } from "vitest";
import {
  normalizeExerciseName,
  nameMatchScore,
  matchExercise,
  DEFAULT_MATCH_THRESHOLD,
} from "@/lib/exercise-match";

describe("normalizeExerciseName", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeExerciseName("  Bulgarian   Split-Squat! ")).toBe(
      "bulgarian split squat",
    );
    expect(normalizeExerciseName("Push-Up")).toBe("push up");
    expect(normalizeExerciseName("DEADLIFT")).toBe("deadlift");
  });
});

describe("nameMatchScore", () => {
  it("scores an exact (case/punctuation-insensitive) match as 1", () => {
    expect(nameMatchScore("Deadlift", "deadlift")).toBe(1);
    expect(nameMatchScore("Bench Press", "bench-press")).toBe(1);
  });

  it("treats reordered token sets as a strong match (the Bulgarian case)", () => {
    const s = nameMatchScore("Bulgarian Split Squat", "Split Squat Bulgarian");
    expect(s).toBeGreaterThanOrEqual(0.95);
  });

  it("bridges spaced vs joined compounds", () => {
    expect(nameMatchScore("Push Up", "Pushup")).toBeGreaterThanOrEqual(0.95);
    expect(nameMatchScore("Pull Up", "pullup")).toBeGreaterThanOrEqual(0.95);
  });

  it("bridges singular vs plural", () => {
    expect(nameMatchScore("Bicep Curl", "Bicep Curls")).toBeGreaterThanOrEqual(
      0.95,
    );
    expect(nameMatchScore("Lunge", "Lunges")).toBeGreaterThanOrEqual(0.95);
    expect(nameMatchScore("Pushup", "Pushups")).toBeGreaterThanOrEqual(0.95);
  });

  it("does NOT collapse a movement with its named variant", () => {
    // Bulgarian Split Squat is a distinct exercise from a plain Split Squat.
    expect(nameMatchScore("Split Squat", "Bulgarian Split Squat")).toBeLessThan(
      DEFAULT_MATCH_THRESHOLD,
    );
  });

  it("does NOT match different movements that share a word", () => {
    expect(nameMatchScore("Bench Press", "Leg Press")).toBeLessThan(
      DEFAULT_MATCH_THRESHOLD,
    );
    expect(nameMatchScore("Barbell Squat", "Barbell Row")).toBeLessThan(
      DEFAULT_MATCH_THRESHOLD,
    );
  });

  it("keeps 'press' intact (does not strip the double-s as a plural)", () => {
    expect(nameMatchScore("Overhead Press", "Overhead Press")).toBe(1);
  });

  it("folds equipment abbreviations (DB/BB/KB) to the full word", () => {
    // The prod-observed duplicate class: FitBot spells out "Dumbbell", users
    // abbreviate "DB", and the two never matched.
    expect(
      nameMatchScore("DB Bicep Curl", "Dumbbell Bicep Curl"),
    ).toBeGreaterThanOrEqual(0.95);
    expect(
      nameMatchScore("Seated DB Shoulder Press", "Seated Dumbbell Shoulder Press"),
    ).toBeGreaterThanOrEqual(0.95);
    expect(
      nameMatchScore("KB Goblet Squat", "Kettlebell Goblet Squat"),
    ).toBeGreaterThanOrEqual(0.95);
    expect(
      nameMatchScore("DB Romanian Deadlift", "Dumbbell Romanian Deadlift"),
    ).toBeGreaterThanOrEqual(0.95);
  });

  it("expands RDL to Romanian Deadlift", () => {
    expect(
      nameMatchScore("DB RDL", "Dumbbell Romanian Deadlift"),
    ).toBeGreaterThanOrEqual(0.95);
  });

  it("still separates different equipment variants after folding", () => {
    // Folding db->dumbbell must NOT make dumbbell and barbell rows converge.
    expect(
      nameMatchScore("Bent Over DB Row", "Bent Over Barbell Row"),
    ).toBeLessThan(DEFAULT_MATCH_THRESHOLD);
  });

  it("scores empty / whitespace names as 0", () => {
    expect(nameMatchScore("", "deadlift")).toBe(0);
    expect(nameMatchScore("   ", "deadlift")).toBe(0);
  });
});

describe("matchExercise", () => {
  const catalog = [
    { id: "1", name: "Split Squat Bulgarian" },
    { id: "2", name: "Barbell Bench Press" },
    { id: "3", name: "Bicep Curls" },
    { id: "4", name: "Plank" },
  ];

  it("resolves a reordered name to the existing library exercise", () => {
    const m = matchExercise("Bulgarian Split Squat", catalog);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("1");
  });

  it("resolves a plural/singular difference", () => {
    const m = matchExercise("Bicep Curl", catalog);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("3");
  });

  it("returns null when nothing clears the threshold (create-new)", () => {
    // "Glute Bridge" shares no strong signal with anything in the catalog.
    expect(matchExercise("Glute Bridge", catalog)).toBeNull();
  });

  it("does not match a plain Bench Press onto Barbell Bench Press", () => {
    // Equipment-qualified variant is treated as distinct (safe: create new).
    expect(matchExercise("Bench Press", catalog)).toBeNull();
  });

  it("returns the highest-scoring match when several clear the threshold", () => {
    const dupes = [
      { id: "a", name: "Bicep Curl Variation" }, // partial overlap
      { id: "b", name: "Bicep Curls" }, // near-exact
    ];
    const m = matchExercise("Bicep Curl", dupes);
    expect(m!.id).toBe("b");
  });

  it("returns null for an empty candidate", () => {
    expect(matchExercise("", catalog)).toBeNull();
  });

  it("reuses an existing exercise when FitBot reorders the qualifier", () => {
    // The exact case the program-builder reconcile guards against: FitBot names
    // a lift "Incline Bicep Curls" while the catalog already has it as
    // "Bicep Curls - Incline" -> must reuse, not spawn a duplicate.
    const cat = [{ id: "x", name: "Bicep Curls - Incline" }];
    const m = matchExercise("Incline Bicep Curls", cat);
    expect(m).not.toBeNull();
    expect(m!.id).toBe("x");
  });
});

/**
 * 2026-08-25: Ivo imported a JSON routine and several exercises were created as
 * duplicates of ones he already had. These are the exact names from that
 * import, with the scores they produced before the fix.
 */
describe("import near-miss names (2026-08-25 regression)", () => {
  const catalog = [
    { id: "1", name: "Barbell Squat" },
    { id: "2", name: "Dumbbell Overhead Press (DB OHP)" },
    { id: "3", name: "Bench Press" },
    { id: "4", name: "Lat Pulldown" },
    // Keep-separate pairs must survive every change below.
    { id: "5", name: "Split Squats" },
    { id: "6", name: "Bulgarian Split Squats" },
    { id: "7", name: "Front Squat" },
    { id: "8", name: "Pull-ups" },
    { id: "9", name: "Pull Ups Assisted" },
  ];

  it("matches a barbell back squat to the barbell squat (was 0.67, created a duplicate)", () => {
    expect(matchExercise("Barbell Back Squats", catalog)?.name).toBe("Barbell Squat");
  });

  it("leaves a BARE 'Back Squat' to the user rather than guessing the equipment", () => {
    // Deliberate. With no equipment word this could be any squat variant, and
    // auto-matching it would mean ignoring "barbell" - the exact loosening that
    // would also fold Split into Bulgarian Split Squat. It does not auto-match,
    // but it clears the import preview's 0.5 suggestion floor, so the importer
    // offers it and Ivo decides.
    expect(matchExercise("Back Squat", catalog)).toBeNull();
    expect(nameMatchScore("Back Squat", "Barbell Squat")).toBeGreaterThanOrEqual(0.5);
  });

  it("ignores a parenthetical gloss (was 0.75, created a duplicate)", () => {
    expect(matchExercise("DB Overhead Press", catalog)?.name).toBe(
      "Dumbbell Overhead Press (DB OHP)",
    );
    expect(matchExercise("Dumbbell Overhead Press", catalog)?.name).toBe(
      "Dumbbell Overhead Press (DB OHP)",
    );
  });

  it("ignores an 'or ...' alternative, taking the movement actually prescribed", () => {
    expect(normalizeExerciseName("Barbell Back Squats or Front Squats")).toBe(
      "barbell back squats",
    );
  });

  it("STILL refuses the keep-separate pairs", () => {
    // The whole point of the conservative threshold. A wrong merge corrupts
    // history; these must never fold together.
    expect(nameMatchScore("Split Squats", "Bulgarian Split Squats")).toBeLessThan(0.8);
    expect(nameMatchScore("Front Squat", "Barbell Squat")).toBeLessThan(0.8);
    expect(nameMatchScore("Front Squat", "Back Squat")).toBeLessThan(0.8);
    expect(nameMatchScore("Pull-ups", "Pull Ups Assisted")).toBeLessThan(0.8);
    expect(nameMatchScore("Bench Press", "Leg Press")).toBeLessThan(0.8);
  });

  it("does not fold a front squat into a back squat via the phrase synonym", () => {
    // "back squat" -> "squat" must NOT bring "front squat" with it.
    expect(matchExercise("Front Squat", catalog)?.name).toBe("Front Squat");
  });
});

describe("pluralised abbreviations expand (2026-08-27)", () => {
  it("scores a plural abbreviation the same as its singular", () => {
    // The lookup ran before singularization, so "RDLs" never expanded and the
    // same movement scored 0.50 plural vs 0.95 singular.
    expect(nameMatchScore("Single-Leg Dumbbell RDLs", "RDL Dumbbells Single Leg")).toBeCloseTo(
      nameMatchScore("Single-Leg Dumbbell RDL", "RDL Dumbbells Single Leg"),
      2,
    );
    expect(nameMatchScore("Single-Leg Dumbbell RDLs", "RDL Dumbbells Single Leg")).toBeGreaterThanOrEqual(0.8);
  });

  it("does the same for other equipment abbreviations", () => {
    expect(nameMatchScore("DBs Bicep Curl", "Dumbbell Bicep Curl")).toBeGreaterThanOrEqual(0.8);
  });
});
