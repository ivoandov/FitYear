import { describe, it, expect } from "vitest";
import {
  addDaysToDateKey,
  localDateKey,
  localDateKeyInZone,
  parseServerDate,
  scheduledDateFromKey,
  scheduledDateKey,
  startOfLocalDayUtc,
} from "@/lib/date";

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

describe("scheduled workouts survive being read from another zone", () => {
  it("noon UTC lands on the same calendar day from UTC-11 to UTC+11", () => {
    // Local midnight does NOT: midnight in Los Angeles is 07:00Z, which every
    // zone west of it reads as the previous day. That is the Honolulu bug.
    const key = (d: Date, tz: string) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(d);

    const safe = scheduledDateFromKey("2026-08-27");
    for (const tz of [
      "Pacific/Honolulu", "America/Los_Angeles", "America/New_York",
      "UTC", "Europe/London", "Asia/Bangkok", "Asia/Manila", "Australia/Sydney",
    ]) {
      expect(key(safe, tz), `noon UTC failed in ${tz}`).toBe("2026-08-27");
    }

    // The old scheme, for contrast: correct east of LA, wrong west of it.
    const midnightLa = new Date("2026-08-27T07:00:00.000Z");
    expect(key(midnightLa, "America/Los_Angeles")).toBe("2026-08-27");
    expect(key(midnightLa, "Pacific/Honolulu")).toBe("2026-08-26");
  });

  it("adds days without touching timezones", () => {
    expect(addDaysToDateKey("2026-08-27", 0)).toBe("2026-08-27");
    expect(addDaysToDateKey("2026-08-27", 1)).toBe("2026-08-28");
    expect(addDaysToDateKey("2026-08-27", 5)).toBe("2026-09-01");
    // Across a DST boundary, where naive Date arithmetic slips an hour.
    expect(addDaysToDateKey("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("scheduledDateKey - reading an authored day back", () => {
  it("is the exact inverse of scheduledDateFromKey", () => {
    for (const key of ["2026-08-27", "2026-01-01", "2026-12-31", "2028-02-29"]) {
      expect(scheduledDateKey(scheduledDateFromKey(key))).toBe(key);
    }
  });

  it("reads the SAME day in every zone, including UTC+12 and beyond", () => {
    // The bug this exists to prevent: resolving the stored instant in the
    // viewer's zone shipped a day late in the Liv payload from UTC+12 east.
    // Auckland is not an edge case.
    const stored = scheduledDateFromKey("2026-08-27");
    for (const tz of [
      "Pacific/Midway",       // UTC-11
      "America/Los_Angeles",
      "UTC",
      "Asia/Makassar",        // UTC+8
      "Pacific/Auckland",     // UTC+12, was WRONG
      "Pacific/Chatham",      // UTC+12:45, was WRONG
      "Pacific/Kiritimati",   // UTC+14, was WRONG
    ]) {
      const viaZone = localDateKeyInZone(stored, tz);
      expect(scheduledDateKey(stored), `zone-free read must hold in ${tz}`).toBe("2026-08-27");
      // Documents WHICH zones the old zone-resolving read got wrong.
      if (tz === "Pacific/Auckland" || tz === "Pacific/Chatham" || tz === "Pacific/Kiritimati") {
        expect(viaZone, `${tz} is exactly the case that broke`).toBe("2026-08-28");
      }
    }
  });

  it("accepts the string form a driver hands back", () => {
    expect(scheduledDateKey("2026-08-27T12:00:00.000Z")).toBe("2026-08-27");
  });
});
