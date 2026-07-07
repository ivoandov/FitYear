import { describe, it, expect } from "vitest";
import { parseServerDate, localDateKey } from "@/lib/date";

describe("parseServerDate", () => {
  it("treats a no-timezone string as UTC", () => {
    // 2026-07-05 12:00:00 (no offset) -> that instant in UTC
    const d = parseServerDate("2026-07-05 12:00:00");
    expect(d.toISOString()).toBe("2026-07-05T12:00:00.000Z");
  });
  it("parses a Z-suffixed ISO string as-is", () => {
    const d = parseServerDate("2026-07-05T12:00:00.000Z");
    expect(d.toISOString()).toBe("2026-07-05T12:00:00.000Z");
  });
  it("parses an offset-carrying string as-is", () => {
    // -05:00 offset -> 17:00 UTC
    const d = parseServerDate("2026-07-05T12:00:00-05:00");
    expect(d.toISOString()).toBe("2026-07-05T17:00:00.000Z");
  });
  it("passes a Date through unchanged", () => {
    const orig = new Date("2026-07-05T12:00:00.000Z");
    expect(parseServerDate(orig)).toBe(orig);
  });
});

describe("localDateKey", () => {
  it("buckets by the local calendar day (late-evening does not roll over)", () => {
    // A local Date constructed from local components; the key must echo them
    // regardless of the machine's UTC offset.
    const lateEvening = new Date(2026, 6, 5, 20, 30, 0); // 2026-07-05 20:30 local
    expect(localDateKey(lateEvening)).toBe("2026-07-05");
  });
  it("zero-pads month and day", () => {
    const d = new Date(2026, 0, 3, 9, 0, 0); // 2026-01-03 local
    expect(localDateKey(d)).toBe("2026-01-03");
  });
  it("accepts a server timestamp string", () => {
    // Midday UTC is the same calendar day in every real-world offset.
    expect(localDateKey("2026-07-05T12:00:00.000Z")).toBe("2026-07-05");
  });
});
