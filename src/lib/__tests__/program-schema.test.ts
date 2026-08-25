import { describe, it, expect } from "vitest";
import {
  SkeletonSchema,
  PhaseVarietySchema,
  AnchorLiftSchema,
  PhaseAccessorySchema,
} from "@/lib/program-schema";

/**
 * A program build is ONE metered skeleton call plus one call per phase, and the
 * quota unit is charged up front. So the schema must never discard a whole
 * build over a field the model spelled differently.
 *
 * These are not invented edge cases: `exerciseType` was the live production
 * failure. The skeleton prompt never listed the legal values, so whenever the
 * model programmed a conditioning anchor it emitted "time" or "time_based" and
 * `z.enum().default()` (which only fills a MISSING field, never an invalid one)
 * rejected the entire skeleton. The two values below are the exact strings
 * observed from claude-sonnet-5 while reproducing Ivo's report.
 */

function anchor(overrides: Record<string, unknown> = {}) {
  return {
    name: "Farmer's Carry",
    muscleGroups: ["Forearms"],
    exerciseType: "weight_reps",
    isAssisted: false,
    restSeconds: 120,
    progression: { scheme: "linear", startLoadLbs: 70, incrementLbs: 5, sets: 3, reps: "40m" },
    ...overrides,
  };
}

describe("AnchorLiftSchema exerciseType tolerance", () => {
  it("accepts the two canonical values unchanged", () => {
    expect(AnchorLiftSchema.parse(anchor({ exerciseType: "weight_reps" })).exerciseType).toBe("weight_reps");
    expect(AnchorLiftSchema.parse(anchor({ exerciseType: "distance_time" })).exerciseType).toBe("distance_time");
  });

  // The two strings actually observed from the model in production repro.
  it.each(["time", "time_based"])("maps the observed bad value %s to distance_time", (bad) => {
    expect(AnchorLiftSchema.parse(anchor({ exerciseType: bad })).exerciseType).toBe("distance_time");
  });

  it.each(["cardio", "duration", "Distance-Time", "  DISTANCE_TIME  ", "conditioning", "carry"])(
    "maps time/distance-flavoured value %s to distance_time",
    (v) => {
      expect(AnchorLiftSchema.parse(anchor({ exerciseType: v })).exerciseType).toBe("distance_time");
    },
  );

  it("falls back to weight_reps for a missing, null or unrecognised value", () => {
    expect(AnchorLiftSchema.parse(anchor({ exerciseType: undefined })).exerciseType).toBe("weight_reps");
    expect(AnchorLiftSchema.parse(anchor({ exerciseType: null })).exerciseType).toBe("weight_reps");
    expect(AnchorLiftSchema.parse(anchor({ exerciseType: "banana" })).exerciseType).toBe("weight_reps");
    expect(AnchorLiftSchema.parse(anchor({ exerciseType: 7 })).exerciseType).toBe("weight_reps");
  });
});

describe("numeric + boolean tolerance", () => {
  it("coerces a numeric reps prescription to a string", () => {
    const a = AnchorLiftSchema.parse(anchor({ progression: { scheme: "linear", startLoadLbs: 135, incrementLbs: 5, sets: 4, reps: 5 } }));
    expect(a.progression.reps).toBe("5");
  });

  it("accepts string booleans for isAssisted", () => {
    expect(AnchorLiftSchema.parse(anchor({ isAssisted: "true" })).isAssisted).toBe(true);
    expect(AnchorLiftSchema.parse(anchor({ isAssisted: "false" })).isAssisted).toBe(false);
    expect(AnchorLiftSchema.parse(anchor({ isAssisted: "maybe" })).isAssisted).toBe(false);
  });

  it("normalises whatever the model calls the progression scheme", () => {
    expect(AnchorLiftSchema.parse(anchor({ progression: { scheme: "linear progression", startLoadLbs: 0, incrementLbs: 0, sets: 3, reps: "8" } })).progression.scheme).toBe("linear");
  });

  it("clamps out-of-range loads and sets instead of rejecting the build", () => {
    const a = AnchorLiftSchema.parse(anchor({ progression: { scheme: "linear", startLoadLbs: -20, incrementLbs: 5000, sets: 99, reps: "5" } }));
    expect(a.progression.startLoadLbs).toBe(0);
    expect(a.progression.incrementLbs).toBe(100);
    expect(a.progression.sets).toBe(10);
  });
});

describe("PhaseAccessorySchema tolerance", () => {
  const acc = (o: Record<string, unknown> = {}) => ({
    name: "Rower Intervals",
    muscleGroups: ["Cardio"],
    exerciseType: "time",
    sets: 3,
    reps: "500m",
    rest: 90,
    ...o,
  });

  it("normalises exerciseType and keeps the accessory", () => {
    expect(PhaseAccessorySchema.parse(acc()).exerciseType).toBe("distance_time");
  });

  it("coerces numeric reps and clamps rest", () => {
    const p = PhaseAccessorySchema.parse(acc({ reps: 12, rest: -5 }));
    expect(p.reps).toBe("12");
    expect(p.rest).toBe(0);
  });
});

describe("a full skeleton with a conditioning anchor still parses", () => {
  // This is the shape that used to 502 the whole build.
  const skeleton = {
    name: "Athletic Base",
    durationWeeks: 26,
    workouts: [
      {
        label: "Conditioning",
        muscleGroups: ["Cardio"],
        anchorLifts: [
          anchor({ exerciseType: "time_based" }),
          anchor({ name: "Sled Push", exerciseType: "time" }),
        ],
      },
    ],
    cycle: [0, -1],
    phases: [{ name: "Foundation", focus: "conditioning", startWeek: 1, endWeek: 26 }],
    deloadWeeks: [4],
    deloadLoadFactor: 0.9,
  };

  it("parses and normalises both anchors", () => {
    const parsed = SkeletonSchema.parse(skeleton);
    expect(parsed.workouts[0].anchorLifts.map((a) => a.exerciseType)).toEqual([
      "distance_time",
      "distance_time",
    ]);
  });
});

describe("PhaseVarietySchema", () => {
  it("tolerates a phase whose accessories carry invented exercise types", () => {
    const parsed = PhaseVarietySchema.parse({
      days: [
        {
          label: "Conditioning",
          workoutName: "Engine Builder",
          accessories: [
            { name: "Row", muscleGroups: ["Cardio"], exerciseType: "cardio", sets: 4, reps: "250m", rest: 60 },
          ],
        },
      ],
    });
    expect(parsed.days[0].accessories[0].exerciseType).toBe("distance_time");
  });
});
