import { describe, it, expect } from "vitest";
import { parseWeekStart } from "@/lib/api/week";

describe("parseWeekStart", () => {
  it("defaults to sunday, matching the app setting's default", () => {
    expect(parseWeekStart(null)).toBe("sunday");
    expect(parseWeekStart(undefined)).toBe("sunday");
    expect(parseWeekStart("garbage")).toBe("sunday");
  });

  it("honours an explicit monday", () => {
    expect(parseWeekStart("monday")).toBe("monday");
  });
});
