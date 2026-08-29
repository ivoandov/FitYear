/**
 * Cori, via Ivo (2026-08-28): "One of my requests is I can never find old
 * workouts. The recents section is great but then the library section is hard
 * to use. Oh I think also not all my workouts save to library or show there?"
 *
 * Two real gaps, not a usability complaint. History listed every session as a
 * flat unsearchable scroll, and the Library only ever held TEMPLATES - created
 * deliberately - so finishing a workout never put one there and there was no
 * route from "I did this weeks ago" to doing it again.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { seedCompletedWorkout, seedPartialWorkout } from "./helpers";

test("History can be searched by workout name and by exercise", async ({ page, account }) => {
  await seedCompletedWorkout(account.id, "ZZ Leg Day Alpha");
  await seedCompletedWorkout(account.id, "ZZ Pull Day Beta");

  await page.goto("/history");
  const search = page.getByTestId("input-history-search");
  await expect(search).toBeVisible();

  await expect(page.getByText("ZZ Leg Day Alpha")).toBeVisible();
  await expect(page.getByText("ZZ Pull Day Beta")).toBeVisible();

  // By workout name.
  await search.fill("Pull Day Beta");
  await expect(page.getByText("ZZ Pull Day Beta")).toBeVisible();
  await expect(page.getByText("ZZ Leg Day Alpha")).toBeHidden();

  // By an EXERCISE inside it - how people actually look for a session. The
  // seed logs "Bench Press", which appears in neither workout's name.
  await search.fill("Bench Press");
  await expect(page.getByText("ZZ Pull Day Beta")).toBeVisible();

  await search.fill("nothing matches this");
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
});

test("a past workout appears in the Library and can be repeated", async ({ page, account }) => {
  const { workoutId } = await seedPartialWorkout(account.id, "ZZ Repeatable Session");

  await page.goto("/");
  const card = page.getByTestId(`card-library-past-${workoutId}`);
  await expect(card).toBeVisible();
  await expect(card.getByText("ZZ Repeatable Session")).toBeVisible();

  await page.getByTestId(`button-repeat-workout-${workoutId}`).click();
  await page.waitForURL(/\/workout-preview/);

  // Only the exercise that was actually LOGGED comes across. Repeating a
  // session you abandoned half way should give you the half you did.
  await expect(page.getByText("Finished Lift")).toBeVisible();
  await expect(page.getByText("Ran Out Of Time")).toBeHidden();
});
