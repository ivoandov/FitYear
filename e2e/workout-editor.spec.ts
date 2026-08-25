/**
 * Durable guard for the workout editor at a PHONE viewport (390x844, touch),
 * which is where Ivo reported that reordering, the arrows and adding an
 * exercise all did nothing.
 *
 * WHAT THIS DOES AND DOES NOT PROVE. Chromium's mobile emulation does not
 * reproduce iOS Safari's behaviour where a `draggable` ancestor swallows taps
 * aimed at its children, so this spec would likely have passed BEFORE the
 * pointer-gating fix too. It is a regression guard for the parts that are
 * genuinely verifiable here:
 *   - the arrows reorder and the change survives Save + reload
 *   - an exercise already in the workout can be added AGAIN (duplicates were
 *     silently refused, which read as "the add button does nothing")
 *   - removing one copy of a duplicate removes ONLY that row (remove used to
 *     filter by exercise id and delete every copy)
 *   - the per-exercise `sets` prescription survives an edit (every save used to
 *     force sets:3 / defaultWeight:135 / defaultReps:10 onto every exercise)
 *   - a newly created exercise sorts to the top of the picker, marked "New"
 *
 * The iOS-only tap-swallowing itself still needs a real device to confirm.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedActiveWorkout, seedExercise, sql } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test("editor works at a phone viewport", async ({ page, account }) => {
  // Three distinct exercises in a known order.
  const benchId = await seedExercise(account.id, "ZZ Bench", ["Chest"]);
  const rowId = await seedExercise(account.id, "ZZ Row", ["Back"]);
  const curlId = await seedExercise(account.id, "ZZ Curl", ["Biceps"]);

  const mk = (id: string, name: string, i: number) => ({
    id,
    name,
    muscleGroups: ["Chest"],
    description: "",
    exerciseType: "weight_reps",
    isAssisted: false,
    instanceId: `drive-${i}`,
    sets: 5, // deliberately NOT 3: proves the editor no longer resets it
    defaultWeight: 200,
    defaultReps: 5,
  });

  await seedActiveWorkout(
    account.id,
    {
      id: "drive-w",
      displayId: "drive-w",
      name: "Drive Workout",
      exercises: [mk(benchId, "ZZ Bench", 0), mk(rowId, "ZZ Row", 1), mk(curlId, "ZZ Curl", 2)],
    },
    null,
  );

  await page.goto("/track");
  await expect(page.getByTestId("button-edit-workout")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("button-edit-workout").click();

  const dialog = page.getByTestId("dialog-workout-editor");
  await expect(dialog).toBeVisible();
  await page.getByTestId("tab-exercises").click();

  const rows = page.locator('[data-testid^="selected-exercise-"]');
  await expect(rows.first()).toBeVisible();
  const orderOf = async () => (await rows.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  const before = await orderOf();
  console.log("ORDER BEFORE:", JSON.stringify(before));
  expect(before[0]).toContain("ZZ Bench");

  // --- 1. arrows reorder on a touch viewport (the reported failure) ---
  await page.getByTestId(`button-move-down-${benchId}`).click();
  const after = await orderOf();
  console.log("ORDER AFTER ARROW:", JSON.stringify(after));
  expect(after[0]).toContain("ZZ Row");
  expect(after[1]).toContain("ZZ Bench");

  // --- 2. adding an exercise ALREADY in the workout adds a second copy ---
  await page.getByTestId(`available-exercise-${benchId}`).click();
  await expect(page.getByTestId(`count-selected-${benchId}`)).toHaveText("x2");
  await expect(rows).toHaveCount(4);

  // --- 3. removing one copy removes only that row ---
  const benchRows = page.locator(`[data-testid="selected-exercise-${benchId}"]`);
  await expect(benchRows).toHaveCount(2);
  await benchRows.last().getByRole("button").last().click();
  await expect(benchRows).toHaveCount(1);
  await expect(rows).toHaveCount(3);

  // --- 4. save, and the reorder must persist ---
  await page.getByTestId("button-save").click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByTestId("button-edit-workout")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("button-edit-workout").click();
  await page.getByTestId("tab-exercises").click();
  await expect(rows.first()).toBeVisible();
  const persisted = await orderOf();
  console.log("ORDER AFTER SAVE+RELOAD:", JSON.stringify(persisted));
  expect(persisted[0]).toContain("ZZ Row");

  // --- 5. the sets prescription survived the edit (was force-reset to 3) ---
  const saved = await sql`select workout_data from active_workouts where user_id = ${account.id}::uuid`;
  const exs = (saved[0].workout_data as { exercises: Array<{ name: string; sets: number }> }).exercises;
  console.log("SAVED SETS:", JSON.stringify(exs.map((e) => [e.name, e.sets])));
  for (const e of exs) expect(e.sets).toBe(5);
});

test("a newly created exercise sorts to the top of the picker, marked New", async ({ page, account }) => {
  await seedExercise(account.id, "AAA Old Legacy Lift", ["Back"]);
  // NOTE: `exercises.created_at` defaults to now(), so anything seeded here is
  // genuinely recent and both of these float above the legacy catalog. The
  // explicit stamp just makes this one strictly newest so the order is exact.
  const freshId = await seedExercise(account.id, "ZZZ Freshly Made", ["Legs"]);
  await sql`update exercises set created_at = now() + interval '1 second' where id = ${freshId}`;

  await seedActiveWorkout(
    account.id,
    {
      id: "drive-w2",
      displayId: "drive-w2",
      name: "Picker Drive",
      exercises: [
        {
          id: "seed-x",
          name: "Placeholder",
          muscleGroups: ["Chest"],
          description: "",
          exerciseType: "weight_reps",
          instanceId: "p-0",
          sets: 3,
        },
      ],
    },
    null,
  );

  await page.goto("/track");
  await page.getByTestId("button-edit-workout").click();
  await page.getByTestId("tab-exercises").click();

  const avail = page.locator('[data-testid^="available-exercise-"]');
  await expect(avail.first()).toBeVisible();
  const names = await avail.allTextContents();
  console.log("PICKER TOP 5:", JSON.stringify(names.slice(0, 5).map((n) => n.replace(/\s+/g, " ").trim())));
  expect(names[0]).toContain("ZZZ Freshly Made");
  await expect(page.getByTestId(`badge-recent-${freshId}`)).toBeVisible();
});
