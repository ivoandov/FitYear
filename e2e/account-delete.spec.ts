/**
 * Account deletion. Apple requires an in-app path to it for any app with
 * sign-in (guideline 5.1.1(v)), so this is a submission blocker for iOS.
 *
 * It is also the most destructive route in the app, so this asserts BOTH
 * directions, which is the whole design:
 *   - everything personal is gone (the cascade from auth.users really ran)
 *   - the SHARED exercise library is NOT gone
 *
 * That second half is not hypothetical. `exercises.user_id` has an ON DELETE
 * CASCADE to auth.users, but the catalog is shared by every user, so a plain
 * deleteUser would delete a departing user's exercises out from under
 * everyone else and strand history rows whose `exercise_id` is a plain varchar
 * with no foreign key. The route releases them to the catalog first.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedCompletedWorkout, seedExercise, sql } from "./helpers";

test("deleting an account removes the user's data and KEEPS their shared exercises", async ({
  page,
  account,
}) => {
  // Something personal, and something contributed to the shared library.
  const exerciseName = `ZZDeleteKeep ${Date.now()}`;
  const exerciseId = await seedExercise(account.id, exerciseName, ["Chest"]);
  await seedCompletedWorkout(account.id, "ZZ Doomed Session");

  const countMine = async () => {
    const [row] = await sql`
      select (
        (select count(*) from completed_workouts where user_id = ${account.id}::uuid) +
        (select count(*) from user_settings     where user_id = ${account.id}::uuid)
      )::int as n`;
    return (row as { n: number }).n;
  };
  expect(await countMine()).toBeGreaterThan(0);

  await page.goto("/settings");
  await page.getByTestId("button-delete-account").click();

  // The confirm button stays disabled until the word is typed exactly: this is
  // instant and irreversible, so a mis-tap must not be able to reach it.
  const confirm = page.getByTestId("button-confirm-delete-account");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("input-confirm-delete-account").fill("delete");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("input-confirm-delete-account").fill("DELETE");
  await expect(confirm).toBeEnabled();

  await confirm.click();
  await page.waitForURL(/\/login/, { timeout: 20_000 });

  // Every personal row is gone, by cascade from auth.users.
  await expect.poll(async () => await countMine(), { timeout: 15_000 }).toBe(0);
  const [{ n: authRows }] = (await sql`
    select count(*)::int as n from auth.users where id = ${account.id}::uuid`) as unknown as Array<{ n: number }>;
  expect(authRows).toBe(0);

  // The shared library entry survives, now owned by nobody - exactly the shape
  // the seeded catalog rows already have.
  const [kept] = (await sql`
    select id, user_id from exercises where id = ${exerciseId}`) as unknown as Array<{
    id: string;
    user_id: string | null;
  }>;
  expect(kept, "the shared catalog entry must NOT be deleted with its author").toBeTruthy();
  expect(kept.user_id, "it should be released to the catalog, not left owned").toBeNull();

  // Clean up the row the fixture can no longer cascade away.
  await sql`delete from exercises where id = ${exerciseId}`;
});
