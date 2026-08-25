import { describe, it, expect } from "vitest";
import {
  isRecentlyAdded,
  sortForPicker,
  createdAtMs,
  RECENT_WINDOW_DAYS,
} from "@/lib/recent-exercises";

const NOW = Date.parse("2026-08-25T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

describe("createdAtMs", () => {
  it("reads ISO strings and Dates, and rejects junk", () => {
    expect(createdAtMs({ createdAt: ago(1) })).toBe(NOW - DAY);
    expect(createdAtMs({ createdAt: new Date(NOW) })).toBe(NOW);
    expect(createdAtMs({ createdAt: null })).toBeNull();
    expect(createdAtMs({ createdAt: undefined })).toBeNull();
    expect(createdAtMs({ createdAt: "not a date" })).toBeNull();
  });
});

describe("isRecentlyAdded", () => {
  it("treats the whole pre-column catalog (null created_at) as not recent", () => {
    // This is the important one: created_at was added WITHOUT a backfill, so
    // all 126 pre-existing exercises are null and must keep their old ordering.
    expect(isRecentlyAdded({ createdAt: null }, NOW)).toBe(false);
    expect(isRecentlyAdded({ createdAt: undefined }, NOW)).toBe(false);
  });

  it("marks exercises inside the window and not outside it", () => {
    expect(isRecentlyAdded({ createdAt: ago(0) }, NOW)).toBe(true);
    expect(isRecentlyAdded({ createdAt: ago(RECENT_WINDOW_DAYS - 1) }, NOW)).toBe(true);
    expect(isRecentlyAdded({ createdAt: ago(RECENT_WINDOW_DAYS + 1) }, NOW)).toBe(false);
  });

  it("counts a clock-skewed future timestamp as recent rather than never", () => {
    expect(isRecentlyAdded({ createdAt: new Date(NOW + DAY) }, NOW)).toBe(true);
  });
});

describe("sortForPicker", () => {
  const legacy = (name: string, muscle: string) => ({ name, muscleGroups: [muscle], createdAt: null });

  it("floats recent exercises to the top, newest first", () => {
    const list = [
      legacy("Zercher Squat", "Legs"),
      { name: "Brand New Curl", muscleGroups: ["Biceps"], createdAt: ago(1) },
      legacy("Arnold Press", "Shoulders"),
      { name: "Newest Thing", muscleGroups: ["Back"], createdAt: ago(0) },
    ];
    // The two recent ones lead, newest first. The rest keep the legacy
    // muscle-then-name ordering, so Legs sorts before Shoulders.
    expect(sortForPicker(list, NOW).map((e) => e.name)).toEqual([
      "Newest Thing",
      "Brand New Curl",
      "Zercher Squat",
      "Arnold Press",
    ]);
  });

  it("keeps the legacy muscle-then-name ordering for everything not recent", () => {
    const list = [
      legacy("Squat", "Legs"),
      legacy("Bench", "Chest"),
      legacy("Fly", "Chest"),
      legacy("Row", "Back"),
    ];
    expect(sortForPicker(list, NOW).map((e) => e.name)).toEqual(["Row", "Bench", "Fly", "Squat"]);
  });

  it("does not mutate its input", () => {
    const list = [legacy("B", "Chest"), legacy("A", "Chest")];
    const copy = [...list];
    sortForPicker(list, NOW);
    expect(list).toEqual(copy);
  });

  it("an aged-out exercise sorts back into normal position", () => {
    const list = [
      legacy("Aardvark Raise", "Back"),
      { name: "Old New Thing", muscleGroups: ["Back"], createdAt: ago(RECENT_WINDOW_DAYS + 5) },
    ];
    expect(sortForPicker(list, NOW).map((e) => e.name)).toEqual([
      "Aardvark Raise",
      "Old New Thing",
    ]);
  });
});
