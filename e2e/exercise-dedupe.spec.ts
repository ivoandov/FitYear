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
  const created = (await first.json()) as { id: string; name: string };

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
  // Names are canonicalized on write now, so the stored name is the canonical
  // form of what was posted, not the raw string.
  expect(body.match.name).toBe(created.name);

  // force:true creates deliberately (the user chose "create anyway").
  const forced = await page.request.post("/api/exercises", {
    data: { ...payload, name: `Cable Rows ZZDedupe ${stamp}`, force: true },
  });
  expect(forced.status()).toBe(201);
});

/**
 * Naming rules run on the WRITE path (2026-08-27). Ivo asked that a poorly
 * constructed name be saved in its corrected form rather than fixed later, so
 * manual adds, imports and FitBot all converge on one spelling.
 */
test("a sloppy name is stored in canonical form", async ({ page, account: _account }) => {
  await page.goto("/");

  const create = async (name: string) => {
    return page.evaluate(async (n) => {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: n,
          description: "e2e naming",
          muscleGroups: ["Chest"],
          exerciseType: "weight_reps",
          force: true,
        }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, name);
  };

  // Equipment trailing -> equipment first.
  const a = await create("ZZ Bicep Curls - Cable");
  expect(a.status).toBe(201);
  expect(a.body.name).toBe("Cable ZZ Bicep Curls");

  // House spelling for push-ups.
  const b = await create("ZZ Knee Pushups");
  expect(b.status).toBe(201);
  expect(b.body.name).toBe("ZZ Knee Push-ups");

  // A parenthetical is kept as a modifier, not dropped.
  // The parenthetical survives as a MODIFIER, and modifiers lead the movement
  // per the Equipment-Modifier-Movement convention.
  const c = await create("ZZ Squat (Heel Elevated)");
  expect(c.status).toBe(201);
  expect(c.body.name).toBe("Heel Elevated ZZ Squat");
});
