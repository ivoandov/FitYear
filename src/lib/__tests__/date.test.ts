import { describe, it, expect } from "vitest";
import { parseServerDate, localDateKey, startOfLocalDayUtc } from "@/lib/date";

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

describe("startOfLocalDayUtc", () => {
  it("returns the UTC instant of local midnight, not UTC midnight", () => {
    // 2026-08-27T16:55Z is 09:55 in Los Angeles (UTC-7 in August).
    const at = new Date("2026-08-27T16:55:00.000Z");
    const start = startOfLocalDayUtc(at, "America/Los_Angeles");
    expect(start.toISOString()).toBe("2026-08-27T07:00:00.000Z");
  });

  it("keeps a session due EARLIER today inside the window", () => {
    // The actual bug: Ivo's Day 1 sat at 14:00Z (07:00 local) and was already
    // "past" by instant at 09:55 local, so it fell out of `upcoming` on the
    // first day of his program.
    const now = new Date("2026-08-27T16:55:00.000Z");
    const day1 = new Date("2026-08-27T14:00:00.000Z");
    expect(day1 >= now).toBe(false); // would have been dropped
    expect(day1 >= startOfLocalDayUtc(now, "America/Los_Angeles")).toBe(true);
  });

  it("still excludes yesterday", () => {
    const now = new Date("2026-08-27T16:55:00.000Z");
    const yesterday = new Date("2026-08-26T20:00:00.000Z");
    expect(yesterday >= startOfLocalDayUtc(now, "America/Los_Angeles")).toBe(false);
  });

  it("works for a zone on the other side of the date line", () => {
    // 16:55Z is already 00:55 on the 28th in Manila.
    const at = new Date("2026-08-27T16:55:00.000Z");
    const start = startOfLocalDayUtc(at, "Asia/Manila");
    expect(start.toISOString()).toBe("2026-08-27T16:00:00.000Z");
  });

  it("handles UTC itself", () => {
    const at = new Date("2026-08-27T16:55:00.000Z");
    expect(startOfLocalDayUtc(at, "UTC").toISOString()).toBe("2026-08-27T00:00:00.000Z");
  });

  it("falls back rather than throwing on an unusable zone", () => {
    const at = new Date("2026-08-27T16:55:00.000Z");
    expect(() => startOfLocalDayUtc(at, "Not/AZone")).not.toThrow();
  });
});
