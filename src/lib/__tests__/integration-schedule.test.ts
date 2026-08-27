import { describe, it, expect } from "vitest";
import {
  buildSchedulePayload,
  toPublicExercise,
  type RawRows,
  type BuildOptions,
} from "@/lib/integration-schedule";
import { localDateKeyInZone, scheduledDateKey } from "@/lib/date";

const NOW = new Date("2026-08-27T16:00:00.000Z"); // 9am in Los Angeles

const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({
  now: NOW,
  windowStart: new Date("2026-08-27T07:00:00.000Z"),
  windowEnd: new Date("2026-09-10T06:59:59.999Z"),
  timeZone: "America/Los_Angeles",
  dateKey: localDateKeyInZone,
  scheduledKey: scheduledDateKey,
  upcomingLimit: 7,
  recentLimit: 3,
  includeExercises: false,
  ...over,
});

const empty: RawRows = { instance: null, cycleLength: null, scheduled: [], completed: [] };

describe("toPublicExercise", () => {
  it("DROPS imageUrl, description and the internal id", () => {
    // Security-relevant, not cosmetic. Some legacy rows still carry Replit-era
    // SIGNED GCS URLs that expired in January 2026; publishing them would hand
    // a consumer dead links plus our bucket and service-account name.
    const out = toPublicExercise({
      name: "Pull Ups Assisted",
      muscleGroups: ["Back"],
      imageUrl:
        "https://storage.googleapis.com/replit-objstore-XXXX/x.png?X-Goog-Signature=deadbeef",
      description: "a long paragraph",
      id: "internal-uuid",
      sets: 3,
      reps: "8-12",
      rest: 90,
    });
    expect(out).toEqual({
      name: "Pull Ups Assisted",
      muscleGroups: ["Back"],
      sets: 3,
      reps: "8-12",
      restSeconds: 90,
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain("storage.googleapis.com");
    expect(json).not.toContain("X-Goog-Signature");
    expect(json).not.toContain("internal-uuid");
  });

  it("survives junk without throwing", () => {
    expect(toPublicExercise({}).name).toBe("");
    expect(toPublicExercise({ muscleGroups: "Chest" }).muscleGroups).toEqual([]);
    expect(toPublicExercise({ reps: 5 }).reps).toBe("5");
  });
});

describe("buildSchedulePayload", () => {
  it("reports an empty schedule as DATA, with active null and arrays present", () => {
    // The consumer distinguishes "could not read it" from "there is nothing".
    // Collapsing those is the bug both codebases refuse to ship, so `active`
    // must be an explicit null and the arrays must never be absent.
    const p = buildSchedulePayload(empty, opts());
    expect(p.active).toBeNull();
    expect(p).toHaveProperty("active");
    expect(p.upcoming).toEqual([]);
    expect(p.recent).toEqual([]);
    expect(p.as_of).toBe("2026-08-27T16:00:00.000Z");
    expect(p.timezone).toBe("America/Los_Angeles");
    // The window the lists describe, so a rest day is distinguishable from a
    // hole in the feed.
    expect(p.covers).toEqual({ from: "2026-08-27", to: "2026-09-09" });
  });

  it("shapes a running program", () => {
    const p = buildSchedulePayload(
      {
        ...empty,
        cycleLength: 7,
        instance: {
          routineName: "30-Day Strength",
          startDate: new Date("2026-08-27T14:00:00.000Z"),
          endDate: new Date("2026-09-02T14:00:00.000Z"),
          durationDays: 7,
          totalWorkouts: 5,
          completedWorkouts: 0,
          skippedWorkouts: 0,
        },
      },
      opts(),
    );
    expect(p.active).toEqual({
      routine_name: "30-Day Strength",
      start_date: "2026-08-27",
      end_date: "2026-09-02",
      duration_days: 7,
      completed_workouts: 0,
      skipped_workouts: 0,
      total_workouts: 5,
      cycle_length: 7,
    });
  });

  it("reports each authored day and flags today against the viewer's zone", () => {
    // Scheduled rows are ALWAYS noon-anchored (scheduledDateFromKey), so the
    // day is read straight off the stored value. `is_today` is the one part
    // that is still zone-dependent, because "today" is a fact about the reader.
    const rows: RawRows = {
      ...empty,
      scheduled: [
        { name: "Today", date: new Date("2026-08-27T12:00:00.000Z"), exercises: [], routineInstanceId: "i", routineDayIndex: 1 },
        { name: "Later", date: new Date("2026-08-29T12:00:00.000Z"), exercises: [], routineInstanceId: null, routineDayIndex: null },
      ],
    };
    const p = buildSchedulePayload(rows, opts());
    expect(p.upcoming[0]).toMatchObject({ date: "2026-08-27", is_today: true, source: "routine", day_index: 1 });
    expect(p.upcoming[1]).toMatchObject({ date: "2026-08-29", is_today: false, source: "manual", day_index: null });
  });

  it("carries the raw UTC instant alongside the day", () => {
    // Kept for diagnosis. The Liv session reads `date` and deliberately does
    // NOT re-derive from `at`; it was re-deriving that made the Honolulu bug
    // visible. Tell that session before `at` ever means a real training time.
    const p = buildSchedulePayload(
      { ...empty, scheduled: [{ name: "X", date: new Date("2026-08-27T12:00:00.000Z"), exercises: [], routineInstanceId: null, routineDayIndex: null }] },
      opts(),
    );
    expect(p.upcoming[0].at).toBe("2026-08-27T12:00:00.000Z");
  });

  it("honours a different zone for the window, but NOT for an authored day", () => {
    // The zone governs `timezone`, `covers` and `is_today`. It must not move a
    // scheduled day: this test used to assert the 28th in Manila for a session
    // authored on the 27th, which was the bug, not the contract.
    const p = buildSchedulePayload(
      { ...empty, scheduled: [{ name: "X", date: new Date("2026-08-27T12:00:00.000Z"), exercises: [], routineInstanceId: null, routineDayIndex: null }] },
      opts({ timeZone: "Asia/Manila" }),
    );
    expect(p.upcoming[0].date).toBe("2026-08-27");
    expect(p.timezone).toBe("Asia/Manila");
  });

  it("omits exercise objects by default and includes them only on request", () => {
    const rows: RawRows = {
      ...empty,
      scheduled: [{ name: "Push", date: NOW, exercises: [{ name: "Bench", sets: 4, reps: "5" }], routineInstanceId: null, routineDayIndex: null }],
    };
    const lean = buildSchedulePayload(rows, opts());
    expect(lean.upcoming[0].exercises).toBeUndefined();
    expect(lean.upcoming[0].exercise_count).toBe(1);

    const full = buildSchedulePayload(rows, opts({ includeExercises: true }));
    expect(full.upcoming[0].exercises).toHaveLength(1);
  });

  it("applies the caps", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      name: `W${i}`, date: NOW, exercises: [], routineInstanceId: null, routineDayIndex: null,
    }));
    const p = buildSchedulePayload(
      { ...empty, scheduled: many, completed: Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, completedAt: NOW })) },
      opts(),
    );
    expect(p.upcoming).toHaveLength(7);
    expect(p.recent).toHaveLength(3);
  });

  it("counts a non-array exercises blob as zero rather than throwing", () => {
    const p = buildSchedulePayload(
      { ...empty, scheduled: [{ name: "Broken", date: NOW, exercises: "nope", routineInstanceId: null, routineDayIndex: null }] },
      opts(),
    );
    expect(p.upcoming[0].exercise_count).toBe(0);
  });

  it("never emits an email or a credential-shaped field", () => {
    const p = buildSchedulePayload(
      { ...empty, completed: [{ name: "Legs", completedAt: NOW }] },
      opts(),
    );
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/@/);
    expect(json).not.toMatch(/token|secret|refresh|password/i);
  });
});

describe("an authored day survives the reader's timezone", () => {
  const scheduled = [
    {
      id: "s1",
      name: "Day 1",
      date: new Date("2026-08-27T12:00:00.000Z"), // authored for the 27th
      exercises: [],
      routineInstanceId: "ri1",
      routineDayIndex: 1,
    },
  ] as unknown as RawRows["scheduled"];

  it("reports the 27th from Auckland, where the old zone-resolved read said the 28th", () => {
    // Ivo travels. Reading a chosen day as an instant made every session in the
    // Liv payload land a day late from UTC+12 east.
    const payload = buildSchedulePayload(
      { instance: null, cycleLength: null, scheduled, completed: [] },
      opts({ timeZone: "Pacific/Auckland" }),
    );
    expect(payload.upcoming[0].date).toBe("2026-08-27");
    // The instant is unchanged; only its INTERPRETATION was ever wrong.
    expect(payload.upcoming[0].at).toBe("2026-08-27T12:00:00.000Z");
  });

  it("reports the same day from Los Angeles, Auckland and Kiritimati alike", () => {
    const day = (tz: string) =>
      buildSchedulePayload(
        { instance: null, cycleLength: null, scheduled, completed: [] },
        opts({ timeZone: tz }),
      ).upcoming[0].date;
    expect(day("America/Los_Angeles")).toBe("2026-08-27");
    expect(day("Pacific/Auckland")).toBe(day("America/Los_Angeles"));
    expect(day("Pacific/Kiritimati")).toBe(day("America/Los_Angeles"));
  });

  it("still resolves a COMPLETED workout in the viewer's zone, because that is a moment", () => {
    // The two kinds of date must not be collapsed: a workout finished at
    // 06:00Z genuinely falls on a different local day in Auckland than in LA.
    const completed = [
      { id: "c1", name: "Done", completedAt: new Date("2026-08-27T06:00:00.000Z") },
    ] as unknown as RawRows["completed"];
    const at = (tz: string) =>
      buildSchedulePayload(
        { instance: null, cycleLength: null, scheduled: [], completed },
        opts({ timeZone: tz }),
      ).recent[0].date;
    expect(at("America/Los_Angeles")).toBe("2026-08-26");
    expect(at("Pacific/Auckland")).toBe("2026-08-27");
  });
});
