import { describe, it, expect } from "vitest";
import { canonicalExerciseName as c } from "@/lib/exercise-naming";

describe("canonicalExerciseName", () => {
  it("puts equipment first", () => {
    expect(c("Bicep Curls - Cable")).toBe("Cable Bicep Curls");
    expect(c("Shoulder Press - Barbell")).toBe("Barbell Shoulder Press");
    expect(c("Incline Bench Press Dumbbells")).toBe("Dumbbell Incline Bench Press");
    expect(c("RDL Barbell")).toBe("Barbell RDL");
  });

  it("dedupes equipment and never doubles Smith Machine", () => {
    // A naive pass produced "Barbell Machine Smith Machine Squat".
    expect(c("Barbell Squats - Smith Machine")).toBe("Smith Machine Barbell Squats");
    expect(c("Incline Bench Press - Smith Machine")).toBe("Smith Machine Incline Bench Press");
  });

  it("KEEPS a parenthetical as a modifier, because it is the identity", () => {
    // Dropping these collapsed two distinct variants onto "Barbell Squat".
    expect(c("Barbell Squat (Heel Elevated)")).toBe("Barbell Heel Elevated Squat");
    expect(c("Barbell Squat (Glute Focused)")).toBe("Barbell Glute Focused Squat");
    expect(c("Barbell Squat (Heel Elevated)")).not.toBe(c("Barbell Squat (Glute Focused)"));
  });

  it("keeps the first option of an 'or' alternative instead of deleting the movement", () => {
    // Truncating at " or " once produced the bare word "Cable".
    expect(c("Cable or Banded External Rotations")).toBe("Cable Band External Rotations");
    expect(c("Conventional or Romanian Deadlifts")).toContain("Deadlifts");
  });

  it("drops a dangling trailing preposition", () => {
    expect(c("Deficit Push-Ups on Parallettes")).toBe("Parallettes Deficit Push-ups");
  });

  it("PRESERVES plurality", () => {
    // Deliberate: exercise-match singularizes both sides at scoring time, so
    // stored plurality is irrelevant to matching and rewriting it would churn
    // history snapshots for nothing.
    expect(c("Tricep Dips")).toBe("Tricep Dips");
    expect(c("Bicep Curls")).toBe("Bicep Curls");
  });

  it("normalises push/pull/chin-up spelling to the house form", () => {
    expect(c("Pushups")).toBe("Push-ups");
    expect(c("Push Ups")).toBe("Push-ups");
    expect(c("push-ups")).toBe("Push-ups");
    expect(c("Knee Pushups")).toBe("Knee Push-ups");
    expect(c("Push Up - Deficit")).toBe("Deficit Push-up");
    expect(c("Pull Ups Assisted")).toBe("Assisted Pull-ups");
    expect(c("Chin-ups")).toBe("Chin-ups");
  });

  it("applies Ivo's explicit overrides", () => {
    expect(c("Cable Fly - Down to Up")).toBe("Cable Fly Low to High");
    expect(c("Cable Fly - Up to Down")).toBe("Cable Fly High to Low");
  });

  it("is IDEMPOTENT - running it on its own output changes nothing", () => {
    // It runs on every write, so a re-save must not keep mutating the name.
    for (const n of [
      "Bicep Curls - Cable",
      "Barbell Squat (Heel Elevated)",
      "Deficit Push-Ups on Parallettes",
      "Knee Pushups",
      "Cable Fly - Down to Up",
      "Incline Bench Press Dumbbells",
    ]) {
      const once = c(n);
      expect(c(once), `not idempotent for ${n}`).toBe(once);
    }
  });

  it("never destroys a name it cannot parse", () => {
    expect(c("Zercher Thruster")).toBe("Zercher Thruster");
    expect(c("Barbell")).toBe("Barbell");
    expect(c("x")).toBe("X");
  });

  it("handles empty and whitespace input without throwing", () => {
    expect(c("")).toBe("");
    expect(c("   ")).toBe("");
  });

  it("respects the 60-character column cap", () => {
    const long = "Extremely Long Dumbbell Chest Supported Incline Rear Delt Raise Variation With Extra Words";
    expect(c(long).length).toBeLessThanOrEqual(60);
  });

  it("does NOT fold one movement into another - that is the matcher's job", () => {
    // Format only. "Barbell Back Squats" must stay a back squat here; the
    // duplicate guard on POST /api/exercises is what maps it to Barbell Squat.
    expect(c("Barbell Back Squats")).toBe("Barbell Back Squats");
    expect(c("Front Squat")).toBe("Front Squat");
  });
});

describe("case handling", () => {
  it("never rewrites intentional mixed case", () => {
    // Title-casing lowercased the tail and turned "ZZDedupe" into "Zzdedupe",
    // silently changing a name the user chose.
    expect(c("ZZDedupe Row")).toBe("ZZDedupe Row");
    expect(c("McGill Big 3")).toContain("McGill");
    expect(c("RDL Barbell")).toBe("Barbell RDL");
  });

  it("still fixes plain lower/upper case", () => {
    expect(c("cable lat pull down")).toBe("Cable Lat Pull Down");
  });
});

describe("hyphen compounds and override stability", () => {
  it("keeps single-letter compounds intact", () => {
    // The internal-hyphen rule split these: "Y-T-W" -> "Y T W", "L-Sit" -> "L Sit".
    expect(c("Prone Y-T-W Raises")).toContain("Y-T-W");
    expect(c("L-Sit Holds")).toContain("L-Sit");
    expect(c("Incline Treadmill (12-3-30)")).toContain("12-3-30");
  });

  it("still splits multi-letter compounds that hid a modifier", () => {
    expect(c("Side-Lying Clamshells")).toBe("Side Lying Clamshells");
    expect(c("Single-Dumbbell Wrist Lowers")).not.toContain("Single-");
  });

  it("every override output is a FIXED POINT", () => {
    // canonicalExerciseName runs on every save, so a name that keeps changing
    // would be rewritten on each one.
    for (const name of [
      "Wrist Holds - Flat Bench",
      "Prone Y-T-W Raises on Incline Bench",
      "Nordic Hamstring Curls (or Slider Curls)",
      "Side-Lying Thoracic Rotation (Open Book)",
      "Cable Fly - Down to Up",
    ]) {
      const once = c(name);
      expect(c(once), `override not stable for ${name}`).toBe(once);
    }
  });
});
