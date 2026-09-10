import { describe, it, expect } from "vitest";
import {
  groupMembers,
  positionInGroup,
  nextInSuperset,
  supersetLabel,
  nextGroupLabel,
} from "@/lib/superset";

const ex = (instanceId: string, supersetGroup?: string | null) => ({ instanceId, supersetGroup });

// Bench + Row as superset A, then a solo squat, then curls + pushdowns as B.
const workout = [
  ex("bench", "A"),
  ex("row", "A"),
  ex("squat"),
  ex("curl", "B"),
  ex("pushdown", "B"),
];

describe("groupMembers", () => {
  it("finds the whole group from any member", () => {
    expect(groupMembers(workout, 0).map((e) => e.instanceId)).toEqual(["bench", "row"]);
    expect(groupMembers(workout, 1).map((e) => e.instanceId)).toEqual(["bench", "row"]);
  });

  it("returns nothing for a solo exercise", () => {
    expect(groupMembers(workout, 2)).toEqual([]);
  });

  it("treats two separate A-blocks as two supersets, not one", () => {
    // A label match alone cannot tell "one four-exercise superset" from "two
    // A-blocks with a squat wedged between", so only a CONTIGUOUS run counts.
    const split = [ex("a1", "A"), ex("a2", "A"), ex("squat"), ex("a3", "A"), ex("a4", "A")];
    expect(groupMembers(split, 0).map((e) => e.instanceId)).toEqual(["a1", "a2"]);
    expect(groupMembers(split, 3).map((e) => e.instanceId)).toEqual(["a3", "a4"]);
  });
});

describe("positionInGroup", () => {
  it("numbers members from 1", () => {
    expect(positionInGroup(workout, 0)).toEqual({ position: 1, total: 2 });
    expect(positionInGroup(workout, 1)).toEqual({ position: 2, total: 2 });
  });

  it("is null for a solo exercise and for a group of one", () => {
    expect(positionInGroup(workout, 2)).toBeNull();
    // A lone labelled exercise is not a superset - it is a typo.
    expect(positionInGroup([ex("only", "A")], 0)).toBeNull();
  });
});

describe("nextInSuperset", () => {
  it("goes straight to the partner with NO rest", () => {
    // The entire point: resting between A1 and A2 makes it two slow exercises.
    expect(nextInSuperset(workout, 0)).toEqual({ nextIndex: 1, restFirst: false });
  });

  it("rests only after the last movement of the round, and loops back", () => {
    expect(nextInSuperset(workout, 1)).toEqual({ nextIndex: 0, restFirst: true });
  });

  it("returns null for a solo exercise so ordinary behaviour is untouched", () => {
    expect(nextInSuperset(workout, 2)).toBeNull();
  });

  it("handles a three-movement giant set", () => {
    const giant = [ex("a", "A"), ex("b", "A"), ex("c", "A")];
    expect(nextInSuperset(giant, 0)).toEqual({ nextIndex: 1, restFirst: false });
    expect(nextInSuperset(giant, 1)).toEqual({ nextIndex: 2, restFirst: false });
    expect(nextInSuperset(giant, 2)).toEqual({ nextIndex: 0, restFirst: true });
  });
});

describe("supersetLabel", () => {
  it("reads like a written program", () => {
    expect(supersetLabel(workout, 0)).toBe("A1");
    expect(supersetLabel(workout, 1)).toBe("A2");
    expect(supersetLabel(workout, 3)).toBe("B1");
    expect(supersetLabel(workout, 2)).toBeNull();
  });
});

describe("nextGroupLabel", () => {
  it("skips labels already in use", () => {
    expect(nextGroupLabel(workout)).toBe("C");
    expect(nextGroupLabel([ex("x")])).toBe("A");
  });

  it("degrades to a number rather than crashing past Z", () => {
    const many = Array.from({ length: 26 }, (_, i) => ex(`e${i}`, String.fromCharCode(65 + i)));
    expect(nextGroupLabel(many)).toBe("27");
  });
});
