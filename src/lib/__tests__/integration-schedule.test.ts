import { describe, it, expect } from "vitest";
import {
  buildSchedulePayload,
  toPublicExercise,
  type RawRows,
  type BuildOptions,
} from "@/lib/integration-schedule";
import { localDateKeyInZone } from "@/lib/date";

const NOW = new Date("2026-08-27T16:00:00.000Z"); // 9am in Los Angeles

const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({
  now: NOW,
  windowStart: new Date("2026-08-27T07:00:00.000Z"),
  windowEnd: new Date("2026-09-10T06:59:59.999Z"),
  timeZone: "America/Los_Angeles",
  dateKey: localDateKeyInZone,
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

  it("resolves dates in the requested zone, and flags today correctly", () => {
    // A session stored at 02:00 UTC is the PREVIOUS evening in Los Angeles.
    // Getting this wrong puts a workout on the wrong day, which is the
    // tz-naive-UTC trap this codebase has hit before.
    const rows: RawRows = {
      ...empty,
      scheduled: [
        { name: "Today", date: new Date("2026-08-27T18:00:00.000Z"), exercises: [], routineInstanceId: "i", routineDayIndex: 1 },
        { name: "Tomorrow", date: new Date("2026-08-29T02:00:00.000Z"), exercises: [], routineInstanceId: null, routineDayIndex: null },
      ],
    };
    const p = buildSchedulePayload(rows, opts());
    expect(p.upcoming[0]).toMatchObject({ date: "2026-08-27", is_today: true, source: "routine", day_index: 1 });
    // 02:00 UTC on the 29th is still the 28th in Los Angeles.
    expect(p.upcoming[1]).toMatchObject({ date: "2026-08-28", is_today: false, source: "manual", day_index: null });
  });

  it("carries the raw UTC instant alongside the local date", () => {
    // So the consumer can re-derive if the default zone is wrong for where Ivo
    // actually is - FitYear stores no timezone to be authoritative from.
    const p = buildSchedulePayload(
      { ...empty, scheduled: [{ name: "X", date: new Date("2026-08-27T18:00:00.000Z"), exercises: [], routineInstanceId: null, routineDayIndex: null }] },
      opts(),
    );
    expect(p.upcoming[0].at).toBe("2026-08-27T18:00:00.000Z");
  });

  it("honours a different zone", () => {
    const p = buildSchedulePayload(
      { ...empty, scheduled: [{ name: "X", date: new Date("2026-08-27T18:00:00.000Z"), exercises: [], routineInstanceId: null, routineDayIndex: null }] },
      opts({ timeZone: "Asia/Manila" }),
    );
    // 18:00 UTC is already the 28th in Manila.
    expect(p.upcoming[0].date).toBe("2026-08-28");
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
