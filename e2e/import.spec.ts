/**
 * Durable guard for importing a plan from another app/site/LLM.
 *
 * Drives the DETERMINISTIC half only. /api/ai/import-parse is a paid model call
 * and, like fit-bot.spec, is deliberately never exercised here - the parse is
 * verified by hand against the real model when the prompt changes. What this
 * covers is the part that can silently corrupt data: reconciling exercise names
 * against the catalog, honouring the user's explicit reuse/create decisions,
 * and writing the routine or template rows.
 *
 * Routes are driven with in-browser fetch because page.request.* does not carry
 * the session cookie here (see the rest-push gotcha).
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedExercise, sql } from "./helpers";

async function post(page: import("@playwright/test").Page, url: string, body: unknown) {
  return page.evaluate(
    async ([u, b]) => {
      const res = await fetch(u as string, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(b),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [url, body] as const,
  );
}

test.describe("import commit", () => {
  test("reuses a matching exercise and creates only genuinely new ones", async ({ page, account }) => {
    // An exercise the import should MATCH rather than duplicate.
    const existingId = await seedExercise(account.id, "ZZ Cable Fly", ["Chest"]);

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/, { timeout: 20000 });

    const plan = {
      kind: "workout",
      name: "ZZ Imported Session",
      exercises: [
        { name: "ZZ Cable Fly", muscleGroups: ["Chest"], exerciseType: "weight_reps", sets: 3, reps: "12", rest: 60, notes: "" },
        { name: "ZZ Totally New Lift", muscleGroups: ["Back"], exerciseType: "weight_reps", sets: 4, reps: "8", rest: 90, notes: "" },
      ],
    };

    const res = await post(page, "/api/import/commit", { plan });
    expect(res.status).toBe(201);
    expect(res.json.kind).toBe("workout");
    expect(res.json.exercisesMatched).toBe(1);
    expect(res.json.exercisesCreated).toBe(1);

    const matched = res.json.report.find((r: { imported: string }) => r.imported === "ZZ Cable Fly");
    expect(matched.action).toBe("matched");
    expect(matched.exerciseId).toBe(existingId);

    // The template really exists and points at the reused row.
    const [tpl] = await sql`select name, exercises from workout_templates where id = ${res.json.templateId}`;
    expect(tpl.name).toBe("ZZ Imported Session");
    const ids = (tpl.exercises as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain(existingId);
  });

  test("an explicit mapping overrides the automatic match in both directions", async ({ page, account }) => {
    const keepId = await seedExercise(account.id, "ZZ Overhead Press", ["Shoulders"]);
    await page.goto("/");

    const plan = {
      kind: "workout",
      name: "ZZ Mapping Session",
      exercises: [
        // Would auto-match ZZ Overhead Press, but the user says make it new.
        { name: "ZZ Overhead Press", muscleGroups: ["Shoulders"], exerciseType: "weight_reps", sets: 3, reps: "8", rest: 90, notes: "" },
        // Would NOT auto-match, but the user points it at an existing row.
        { name: "ZZ Wildly Different Name", muscleGroups: ["Shoulders"], exerciseType: "weight_reps", sets: 3, reps: "8", rest: 90, notes: "" },
      ],
    };

    const res = await post(page, "/api/import/commit", {
      plan,
      mappings: {
        "ZZ Overhead Press": null,
        "ZZ Wildly Different Name": keepId,
      },
    });
    expect(res.status).toBe(201);

    const report: Array<{ imported: string; action: string; exerciseId: string }> = res.json.report;
    const forcedNew = report.find((r) => r.imported === "ZZ Overhead Press")!;
    const forcedReuse = report.find((r) => r.imported === "ZZ Wildly Different Name")!;

    expect(forcedNew.action).toBe("created");
    expect(forcedNew.exerciseId).not.toBe(keepId);
    expect(forcedReuse.action).toBe("matched");
    expect(forcedReuse.exerciseId).toBe(keepId);
  });

  test("a bogus mapping id is not trusted and falls back to matching", async ({ page, account }) => {
    // The id comes from the browser, so the route must verify it.
    await seedExercise(account.id, "ZZ Verify Curl", ["Biceps"]);
    await page.goto("/");

    const res = await post(page, "/api/import/commit", {
      plan: {
        kind: "workout",
        name: "ZZ Bogus Mapping",
        exercises: [
          { name: "ZZ Verify Curl", muscleGroups: ["Biceps"], exerciseType: "weight_reps", sets: 3, reps: "10", rest: 60, notes: "" },
        ],
      },
      mappings: { "ZZ Verify Curl": "00000000-0000-0000-0000-000000000000" },
    });

    expect(res.status).toBe(201);
    // Fell through to the real matcher rather than writing a dangling id.
    expect(res.json.report[0].action).toBe("matched");
    expect(res.json.report[0].exerciseId).not.toBe("00000000-0000-0000-0000-000000000000");
  });

  test("a routine writes one entry per training day and skips rest days", async ({ page, account }) => {
    await page.goto("/");

    const plan = {
      kind: "routine",
      name: "ZZ Imported Program",
      cycleLength: 4,
      days: [
        { dayIndex: 1, workoutName: "ZZ Push", isRest: false, exercises: [{ name: "ZZ Prog Press", muscleGroups: ["Chest"], exerciseType: "weight_reps", sets: 3, reps: "5", rest: 120, notes: "" }] },
        { dayIndex: 2, workoutName: "ZZ Pull", isRest: false, exercises: [{ name: "ZZ Prog Row", muscleGroups: ["Back"], exerciseType: "weight_reps", sets: 3, reps: "8", rest: 120, notes: "" }] },
        { dayIndex: 3, workoutName: "Rest", isRest: true, exercises: [] },
        // Same movement as day 1: must NOT create a second catalog row.
        { dayIndex: 4, workoutName: "ZZ Push B", isRest: false, exercises: [{ name: "ZZ Prog Press", muscleGroups: ["Chest"], exerciseType: "weight_reps", sets: 5, reps: "3", rest: 180, notes: "" }] },
      ],
    };

    const res = await post(page, "/api/import/commit", { plan });
    expect(res.status).toBe(201);
    expect(res.json.kind).toBe("routine");
    expect(res.json.daysGenerated).toBe(3);
    // Two distinct movements across four days.
    expect(res.json.exercisesCreated).toBe(2);

    const [routine] = await sql`select name, cycle_length from routines where id = ${res.json.routineId}`;
    expect(routine.cycle_length).toBe(4);

    const entries = await sql`
      select day_index, workout_name from routine_entries
       where routine_id = ${res.json.routineId} order by day_index`;
    expect(entries.map((e) => e.day_index)).toEqual([1, 2, 4]);

    // The repeated movement resolved to ONE catalog row.
    const rows = await sql`
      select count(*)::int as n from exercises
       where user_id = ${account.id}::uuid and name = 'ZZ Prog Press'`;
    expect(rows[0].n).toBe(1);
  });
});
