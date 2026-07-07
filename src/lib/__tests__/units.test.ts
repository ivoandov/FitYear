import { describe, it, expect } from "vitest";
import {
  LB_PER_KG,
  round1,
  lbsToDisplay,
  displayToLbs,
  convertWeight,
} from "@/lib/units";

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(27.2345)).toBe(27.2);
    expect(round1(27.25)).toBe(27.3);
    expect(round1(135)).toBe(135);
  });
});

describe("lbsToDisplay", () => {
  it("returns lbs unchanged in lbs mode", () => {
    expect(lbsToDisplay(135, "lbs")).toBe(135);
  });
  it("converts lbs to kg rounded to 1 decimal", () => {
    expect(lbsToDisplay(135, "kg")).toBe(round1(135 / LB_PER_KG));
    expect(lbsToDisplay(135, "kg")).toBe(61.2);
  });
  it("passes null/undefined through as null", () => {
    expect(lbsToDisplay(null, "kg")).toBeNull();
    expect(lbsToDisplay(undefined, "lbs")).toBeNull();
  });
});

describe("displayToLbs", () => {
  it("returns value unchanged in lbs mode", () => {
    expect(displayToLbs(135, "lbs")).toBe(135);
  });
  it("converts kg to lbs rounded to 1 decimal", () => {
    expect(displayToLbs(60, "kg")).toBe(round1(60 * LB_PER_KG));
    expect(displayToLbs(60, "kg")).toBe(132.3);
  });
  it("passes null/undefined through as null", () => {
    expect(displayToLbs(null, "kg")).toBeNull();
    expect(displayToLbs(undefined, "lbs")).toBeNull();
  });
});

describe("convertWeight", () => {
  it("is an exact pass-through for the same unit (no rounding)", () => {
    expect(convertWeight(135.4567, "lbs", "lbs")).toBe(135.4567);
    expect(convertWeight(60.1234, "kg", "kg")).toBe(60.1234);
  });
  it("converts lbs -> kg and kg -> lbs, 1 decimal", () => {
    expect(convertWeight(135, "lbs", "kg")).toBe(61.2);
    expect(convertWeight(60, "kg", "lbs")).toBe(132.3);
  });
  it("passes null through", () => {
    expect(convertWeight(null, "lbs", "kg")).toBeNull();
  });
  it("round-trips within rounding tolerance", () => {
    const kg = convertWeight(135, "lbs", "kg")!;
    const backToLbs = convertWeight(kg, "kg", "lbs")!;
    expect(Math.abs(backToLbs - 135)).toBeLessThan(0.5);
  });
});
