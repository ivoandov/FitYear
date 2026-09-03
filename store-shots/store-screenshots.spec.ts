import { test, chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  createTempUser,
  deleteTempUser,
  seedSettings,
  seedExercise,
  applyAuth,
  sql,
} from "../e2e/helpers";

/**
 * Generates the App Store screenshot set.
 *
 * Not part of the durable suite - it lives in its own directory with its own
 * config, because it is slow, it writes files, and a green run says nothing
 * about whether the app works.
 *
 * It drives a REAL production build with a real seeded account, at the exact
 * pixel sizes Apple requires. What it cannot do is put an iOS status bar on
 * top: signing in on the simulator needs an Apple ID in the simulator or the
 * Google iOS OAuth client, and neither exists yet. So these are accurate to
 * the app's UI and are the right shape to submit, but true device captures
 * should replace them once a TestFlight build is on a phone.
 *
 * Run against a production build (never `next dev`):
 *   npm run build && npm run start
 *   npx playwright test --config store-shots/playwright.config.ts
 */

// Apple's required sizes. The 6.9" set covers current devices; the 6.5" set is
// still required for older ones. Both are portrait.
//
// Apple states these in device PIXELS, but a Playwright viewport is in CSS
// pixels, and the app's breakpoints read CSS pixels. Setting the viewport to
// 1290 wide therefore renders the DESKTOP layout - the sidebar rail, a
// two-column home, and two thirds of the image empty - and produces a
// screenshot that is the right size and the wrong app. The device's own point
// width at a 3x scale factor is what gives both: a phone layout AND the
// required output size.
const SIZES = [
  // iPhone 16/17 Pro Max: 430 x 932 points at 3x = 1290 x 2796.
  { label: "6.9-inch", width: 430, height: 932, scale: 3 },
  // iPhone 14 Plus and friends: 428 x 926 points at 3x = 1284 x 2778.
  { label: "6.5-inch", width: 428, height: 926, scale: 3 },
];

// Written outside the code repo, beside the listing copy.
const OUT = resolve(process.env.HOME!, "Projects/FitYear/store/screenshots");

const SHOTS: { name: string; path: string; settle?: (page: Page) => Promise<void> }[] = [
  { name: "1-home", path: "/" },
  { name: "2-history", path: "/history" },
  { name: "3-insights", path: "/insights" },
  { name: "4-exercises", path: "/exercises" },
  { name: "5-fitbot", path: "/fit-bot" },
];


/**
 * Eight weeks of believable training.
 *
 * Deliberately NOT `seedCompletedFor` from the e2e helpers. That one is built
 * for assertions, not for looking at, and two of its choices ruin a screenshot:
 * it hardcodes `name_snapshot` to "PR Exercise", so every strength card is
 * titled that, and it writes `muscle_groups_snapshot` as
 * `${JSON.stringify(arr)}::jsonb`, which postgres.js stores as a jsonb STRING
 * rather than an array - the volume query's `jsonb_typeof = 'array'` guard then
 * silently drops every row and the card reads "No muscle volume logged". Both
 * are documented in MIGRATION_PLAN.md; `sql.json` is the fix for the second.
 *
 * Loads climb week over week so the trend lines have a shape worth showing.
 */
async function seedRealisticHistory(userId: string): Promise<void> {
  const lifts = [
    { name: "Barbell Bench Press", groups: ["Chest"], start: 165, step: 5, reps: 5, day: "Push Day" },
    { name: "Back Squat", groups: ["Legs"], start: 225, step: 10, reps: 5, day: "Leg Day" },
    { name: "Bent Over Barbell Row", groups: ["Back"], start: 135, step: 5, reps: 8, day: "Pull Day" },
    { name: "Overhead Press", groups: ["Shoulders"], start: 95, step: 2.5, reps: 6, day: "Push Day" },
    { name: "Romanian Deadlift", groups: ["Legs"], start: 185, step: 10, reps: 8, day: "Pull Day" },
  ];
  const ids = new Map<string, string>();
  for (const l of lifts) ids.set(l.name, await seedExercise(userId, l.name, l.groups));

  const WEEKS = 8;
  let n = 0;
  for (let week = WEEKS - 1; week >= 0; week--) {
    for (const day of ["Push Day", "Pull Day", "Leg Day"]) {
      const inWorkout = lifts.filter((l) => l.day === day);
      if (!inWorkout.length) continue;
      // Spread across the week and back-date by whole days.
      const daysAgo = week * 7 + (day === "Push Day" ? 5 : day === "Pull Day" ? 3 : 1);
      const [cw] = await sql`
        insert into completed_workouts (user_id, display_id, name, completed_at, started_at, duration_seconds)
        values (
          ${userId}::uuid,
          ${`shots-${Date.now()}-${n++}`},
          ${day},
          now() - ${`${daysAgo} days`}::interval,
          now() - ${`${daysAgo} days`}::interval - interval '58 minutes',
          ${3480}
        )
        returning id`;
      let position = 0;
      for (const lift of inWorkout) {
        const [we] = await sql`
          insert into workout_exercises
            (completed_workout_id, exercise_id, position, name_snapshot, muscle_groups_snapshot, exercise_type, is_assisted)
          values (
            ${cw.id}, ${ids.get(lift.name)!}, ${position++}, ${lift.name},
            ${sql.json(lift.groups)}, 'weight_reps', false
          )
          returning id`;
        const weight = lift.start + (WEEKS - 1 - week) * lift.step;
        for (let set = 1; set <= 4; set++) {
          await sql`
            insert into workout_sets (workout_exercise_id, set_number, weight_lbs, reps, distance, time, completed)
            values (${we.id}, ${set}, ${weight}, ${lift.reps}, 0, 0, true)`;
        }
      }
    }
  }
}

test("generate the App Store screenshot set", async () => {
  const user = await createTempUser("shots");
  await seedSettings(user.id, "lbs");

  await seedRealisticHistory(user.id);

  let browser: Browser | undefined;
  try {
    for (const size of SIZES) {
      const dir = resolve(OUT, size.label);
      mkdirSync(dir, { recursive: true });

      browser = await chromium.launch();
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
        isMobile: true,
        hasTouch: true,
        colorScheme: "dark",
      });
      await applyAuth(context, user.email, user.password);

      const page = await context.newPage();
      for (const shot of SHOTS) {
        await page.goto(shot.path, { waitUntil: "networkidle" });
        // The react-query cache hydrates after first paint; without this the
        // capture is a skeleton on at least one screen every run.
        await page.waitForTimeout(2500);
        await shot.settle?.(page);
        await page.screenshot({ path: resolve(dir, `${shot.name}.png`) });
        console.log(`  ${size.label}/${shot.name}.png`);
      }
      await context.close();
      await browser.close();
      browser = undefined;
    }
  } finally {
    await browser?.close();
    await deleteTempUser(user.id);
  }
  console.log(`\nWrote to ${OUT}`);
});
