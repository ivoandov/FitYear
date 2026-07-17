import { test, expect } from "./fixtures";

// The create API's duplicate guard: a second create whose name fuzzy-matches an
// existing exercise (reordered tokens + plural here) is rejected with 409 + the
// match so callers reuse it; force:true is the deliberate-duplicate escape
// hatch. The temp account's cascade delete cleans up both created rows.
test("create API rejects a near-duplicate name and honors force", async ({
  page,
  account: _account,
}) => {
  const stamp = Date.now();
  const payload = {
    name: `ZZDedupe Cable Row ${stamp}`,
    muscleGroups: ["Back"],
    description: "",
    exerciseType: "weight_reps",
    isAssisted: false,
  };
  await page.goto("/exercises");

  const first = await page.request.post("/api/exercises", { data: payload });
  expect(first.status()).toBe(201);
  const created = (await first.json()) as { id: string };

  // Reordered tokens + plural still resolve to the same exercise.
  const dup = await page.request.post("/api/exercises", {
    data: { ...payload, name: `Cable Rows ZZDedupe ${stamp}` },
  });
  expect(dup.status()).toBe(409);
  const body = (await dup.json()) as {
    error: string;
    match: { id: string; name: string };
  };
  expect(body.error).toBe("duplicate");
  expect(body.match.id).toBe(created.id);
  expect(body.match.name).toBe(payload.name);

  // force:true creates deliberately (the user chose "create anyway").
  const forced = await page.request.post("/api/exercises", {
    data: { ...payload, name: `Cable Rows ZZDedupe ${stamp}`, force: true },
  });
  expect(forced.status()).toBe(201);
});
