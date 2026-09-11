import { describe, it, expect } from "vitest";
import {
  computeHistoricalBests,
  computeHistoricalHolds,
  type BestRow,
} from "@/lib/pr-bests";

const assisted = new Map([["pullup", true]]);
const isHold = (t: string | null | undefined) => t === "weight_time";

function row(over: Partial<BestRow>): BestRow {
  return { exerciseId: "bench", completed: true, ...over };
}

describe("computeHistoricalBests", () => {
  it("takes the heaviest weight and the biggest volume", () => {
    const bests = computeHistoricalBests(
      [
        row({ weight: 135, reps: 5 }),
        row({ weight: 185, reps: 3 }),
        row({ weight: 155, reps: 8 }), // 1,240 - the biggest volume, not the heaviest
      ],
      new Map(),
    );
    expect(bests.get("bench")).toEqual({ bestWeight: 185, maxVolume: 1240, assisted: false });
  });

  it("INVERTS the weight direction for an assisted exercise", () => {
    // On an assisted lift the weight column is counter-assistance, so LOWER is
    // stronger. Reading it the normal way would report the easiest set as the
    // record - the defect that shipped once already.
    const bests = computeHistoricalBests(
      [
        row({ exerciseId: "pullup", weight: 60, reps: 5 }),
        row({ exerciseId: "pullup", weight: 25, reps: 5 }),
      ],
      assisted,
    );
    expect(bests.get("pullup")?.bestWeight).toBe(25);
  });

  it("does not credit volume to an assisted exercise", () => {
    // Counter-assistance times reps is not a quantity of work.
    const bests = computeHistoricalBests(
      [row({ exerciseId: "pullup", weight: 40, reps: 10 })],
      assisted,
    );
    expect(bests.get("pullup")?.maxVolume).toBe(0);
  });

  it("ignores zero-weight rows entirely", () => {
    // A bodyweight set has no load; it is the hold scorer's business, and
    // counting it here would make 0 lbs somebody's weight record.
    const bests = computeHistoricalBests(
      [row({ weight: 0, reps: 20 }), row({ weight: null, reps: 15 })],
      new Map(),
    );
    expect(bests.has("bench")).toBe(false);
  });

  it("counts completed sets only", () => {
    // The tracker prefills rows from history, so an abandoned exercise still
    // carries a weight that was never lifted.
    const bests = computeHistoricalBests(
      [row({ weight: 500, reps: 1, completed: false }), row({ weight: 135, reps: 5 })],
      new Map(),
    );
    expect(bests.get("bench")?.bestWeight).toBe(135);
  });
});

describe("computeHistoricalHolds", () => {
  it("keeps the longest hold and the load it was held at", () => {
    const holds = computeHistoricalHolds(
      [
        row({ exerciseId: "hang", exerciseType: "weight_time", time: 45, weight: 0 }),
        row({ exerciseId: "hang", exerciseType: "weight_time", time: 70, weight: 0 }),
      ],
      (t) => isHold(t),
    );
    expect(holds.get("hang")).toEqual({ seconds: 70, weightLbs: 0 });
  });

  it("scores a ZERO-weight hold, unlike the weight bests", () => {
    // A bodyweight hang is the whole reason holds are scored separately.
    const holds = computeHistoricalHolds(
      [row({ exerciseId: "hang", exerciseType: "weight_time", time: 60, weight: 0 })],
      (t) => isHold(t),
    );
    expect(holds.get("hang")?.seconds).toBe(60);
  });

  it("ignores exercises that are not holds", () => {
    const holds = computeHistoricalHolds(
      [row({ exerciseId: "bench", exerciseType: "weight_reps", time: 90, weight: 135 })],
      (t) => isHold(t),
    );
    expect(holds.size).toBe(0);
  });

  it("counts completed sets only", () => {
    const holds = computeHistoricalHolds(
      [row({ exerciseId: "hang", exerciseType: "weight_time", time: 999, weight: 0, completed: false })],
      (t) => isHold(t),
    );
    expect(holds.size).toBe(0);
  });
});
