import { describe, it, expect } from "vitest";
import {
  planReconciliation,
  distinctCreates,
} from "@/lib/workout-reconcile";
import type { GeneratedExercise } from "@/lib/workout-schema";

// Full-shape helper: the planner only reads `name`, but keep the type honest.
function ex(name: string): GeneratedExercise {
  return {
    name,
    muscleGroups: [],
    exerciseType: "weight_reps",
    isAssisted: false,
    sets: 3,
    reps: "8-12",
    rest: 90,
    notes: "",
  };
}

const catalog = [
  { id: "sq", name: "Split Squat Bulgarian" },
  { id: "bp", name: "Barbell Bench Press" },
  { id: "cu", name: "Bicep Curls" },
];

describe("planReconciliation", () => {
  it("reuses an existing exercise for a reordered name", () => {
    const [p] = planReconciliation([ex("Bulgarian Split Squat")], catalog);
    expect(p.action).toBe("reuse");
    expect(p.exerciseId).toBe("sq");
  });

  it("reuses across a singular/plural difference", () => {
    const [p] = planReconciliation([ex("Bicep Curl")], catalog);
    expect(p.action).toBe("reuse");
    expect(p.exerciseId).toBe("cu");
  });

  it("creates a genuinely-new movement with a normalized createKey", () => {
    const [p] = planReconciliation([ex("Glute Bridge")], catalog);
    expect(p.action).toBe("create");
    expect(p.createKey).toBe("glute bridge");
  });

  it("creates rather than merging a plain movement onto a qualified one", () => {
    const [p] = planReconciliation([ex("Bench Press")], catalog);
    expect(p.action).toBe("create");
  });
});

describe("distinctCreates", () => {
  it("dedupes repeated new movements by normalized name, keeps distinct ones", () => {
    const plan = planReconciliation(
      [ex("Glute Bridge"), ex("Glute Bridge"), ex("Bench Press")],
      catalog,
    );
    const creates = distinctCreates(plan);
    expect(creates.map((c) => c.name).sort()).toEqual([
      "Bench Press",
      "Glute Bridge",
    ]);
  });

  it("returns nothing when every exercise reused an existing one", () => {
    const plan = planReconciliation(
      [ex("Bulgarian Split Squat"), ex("Bicep Curl")],
      catalog,
    );
    expect(distinctCreates(plan)).toHaveLength(0);
  });
});
