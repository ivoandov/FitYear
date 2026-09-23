/**
 * A routine opens when you tap it, and shows what is actually in it.
 *
 * Ivo, 2026-09-22, on his own routines: "When I wanted to hit on the routine in
 * the routines tab, it doesn't really open it. It just selects the text as if I
 * were to try to select text on a browser on a phone. I had to hit the three
 * dots and then click on Edit Routine. Even then I had to scroll down and I
 * still couldn't really see what the exercises for each day were."
 *
 * The card was a plain div with no handler, and no read-only view of a routine
 * existed anywhere in the app.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { sql } from "./helpers";

test("tapping a routine opens it and lists each day's exercises", async ({ page, account }) => {
  const [routine] = await sql`
    insert into routines (user_id, name, default_duration_days)
    values (${account.id}::uuid, 'ZZ Detail Routine', 14)
    returning id`;
  await sql`
    insert into routine_entries (routine_id, day_index, workout_name, exercises)
    values (${routine.id}, 1, 'ZZ Upper Power',
            ${sql.json([
              { name: "ZZ Bench Press", sets: 5, reps: "5", rest: 150, targetLoadLbs: 185 },
              { name: "ZZ Barbell Row", sets: 4, reps: "8-10", rest: 90 },
            ])}),
           (${routine.id}, 3, 'ZZ Lower Power',
            ${sql.json([{ name: "ZZ Back Squat", sets: 5, reps: "5", rest: 180, targetLoadLbs: 225 }])})`;

  await page.goto("/routines");
  const card = page.locator("main").getByTestId(`card-routine-${routine.id}`);
  await expect(card).toBeVisible({ timeout: 20000 });

  // The card itself opens it - not the menu, not the play button.
  await page.locator("main").getByTestId(`button-open-routine-${routine.id}`).click();
  const detail = page.getByTestId("dialog-routine-detail");
  await expect(detail).toBeVisible();

  // Both days, with their exercises and prescriptions - the thing that was
  // missing everywhere in the app.
  await expect(detail.getByTestId("program-day-1")).toContainText("ZZ Upper Power");
  await expect(detail.getByTestId("program-day-1")).toContainText("ZZ Bench Press");
  await expect(detail.getByTestId("program-day-1")).toContainText("5 x 5");
  // A rep RANGE stays a range: collapsing it to a number is the bug the string
  // type exists to prevent.
  await expect(detail.getByTestId("program-day-1")).toContainText("8-10");
  await expect(detail.getByTestId("program-day-3")).toContainText("ZZ Back Squat");

  // And the three things worth doing from here are all present.
  await expect(detail.getByTestId("button-detail-start")).toBeVisible();
  await expect(detail.getByTestId("button-detail-edit")).toBeVisible();
  await expect(detail.getByTestId("button-detail-ask-fitbot")).toBeVisible();
});
