import { test, expect } from "./fixtures";
import { createTempUser, deleteTempUser, seedSettings, seedExercise } from "./helpers";

// Item 9: a user can SEE another user's custom exercise (shared catalog) but
// cannot edit or delete it (owner-only) — and the default library is read-only.
test("sees another user's custom exercise but cannot edit or delete it", async ({
  page,
  account,
}) => {
  const owner = await createTempUser("e2e-owner");
  const exName = `ZZShared ${Date.now()}`;
  let exId = "";
  try {
    await seedSettings(owner.id);
    exId = await seedExercise(owner.id, exName, ["Forearms"]);

    await page.goto("/exercises");

    // Visible in the shared catalog.
    await expect(page.getByTestId(`text-exercise-name-${exId}`)).toBeVisible();
    // View-only for a non-owner: can add to a workout, but no owner controls.
    await expect(page.getByTestId(`button-add-exercise-${exId}`)).toBeVisible();
    await expect(page.getByTestId(`button-edit-exercise-${exId}`)).toHaveCount(0);
    await expect(page.getByTestId(`button-delete-exercise-${exId}`)).toHaveCount(0);
    await expect(page.getByTestId(`button-regenerate-image-${exId}`)).toHaveCount(0);

    // The API rejects a non-owner write (uses the account's session cookies).
    const put = await page.request.put(`/api/exercises/${exId}`, {
      data: { name: "HACKED" },
    });
    expect(put.status()).toBe(403);
    const del = await page.request.delete(`/api/exercises/${exId}`);
    expect(del.status()).toBe(403);
  } finally {
    // deleting the owner cascades to their exercise
    await deleteTempUser(owner.id);
  }
});

// Owner-positive: the creator DOES get Edit/Delete/Regenerate on their own
// custom exercise. Guards the regression where the exercises page dropped
// `userId` from its exercise objects, making isOwner always false so nobody
// could edit their own exercises from the library.
test("owner sees edit/delete/regenerate controls on their own exercise", async ({
  page,
  account,
}) => {
  const exName = `ZZOwned ${Date.now()}`;
  const exId = await seedExercise(account.id, exName, ["Forearms"]);

  await page.goto("/exercises");

  await expect(page.getByTestId(`text-exercise-name-${exId}`)).toBeVisible();
  await expect(page.getByTestId(`button-edit-exercise-${exId}`)).toBeVisible();
  await expect(page.getByTestId(`button-delete-exercise-${exId}`)).toBeVisible();
  // Regenerate lives on the image overlay; this seeded exercise has no image,
  // so the delete X (no-image branch) is the reliable owner-control signal.
  // The owner's PUT succeeds where a non-owner got 403.
  const put = await page.request.put(`/api/exercises/${exId}`, {
    data: { name: exName, muscleGroups: ["Forearms"], description: "owned edit", exerciseType: "weight_reps" },
  });
  expect(put.ok()).toBeTruthy();
});
