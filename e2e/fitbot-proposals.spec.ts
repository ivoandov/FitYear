/**
 * FitBot's chat, from Ivo's first real run of building and starting a program
 * through it (2026-10-02, evening, Los Angeles):
 *
 *   "when I chat with it, sometimes I can't see the end of his response as it's
 *   behind the chat box. i had it make a routine for me, it made one and just
 *   asked me to approve without actually showing me the whole thing ... when i
 *   finally approved it, nothing happened at first click ... the first workout
 *   was already showing past due and it was set for yesterday".
 *
 * The model is NEVER called: `/api/ai/chat` is answered here with the same
 * NDJSON events the route streams, one scripted reply per request. Approving a
 * card still goes to the REAL endpoint, which is where the day-early bug lived.
 */
import { expect, type Page } from "@playwright/test";
import { test } from "./fixtures";
import { sql } from "./helpers";

type Event = Record<string, unknown>;

/** Answer each chat request with the next scripted reply; then just "Noted." */
async function scriptChat(page: Page, replies: Event[][]) {
  const queue = [...replies];
  await page.route("**/api/ai/chat**", async (route) => {
    const events = queue.shift() ?? [{ type: "text", text: "Noted." }];
    const body = [...events, { type: "done", history: [] }].map((e) => JSON.stringify(e)).join("\n") + "\n";
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
}

async function say(page: Page, text: string) {
  const main = page.locator("main");
  await main.getByTestId("input-chat").fill(text);
  await main.getByTestId("button-send-chat").click();
}

/** A YYYY-MM-DD this many days from today, in UTC; far enough out that zones do not matter. */
function dayFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seedRoutine(userId: string, name: string) {
  const [routine] = await sql`
    insert into routines (user_id, name, default_duration_days, cycle_length)
    values (${userId}::uuid, ${name}, 14, 7)
    returning id`;
  const day = (n: number, workoutName: string, exercise: string) => sql`
    insert into routine_entries (routine_id, day_index, workout_name, exercises)
    values (${routine.id}, ${n}, ${workoutName},
            ${sql.json([{ name: exercise, sets: 3, reps: "8-10", rest: 90, targetLoadLbs: 135, notes: "Slow lowering." }])})`;
  await day(1, "ZZ Pull Day", "ZZ Cable Row");
  await day(3, "ZZ Push Day", "ZZ Incline Press");
  return routine.id as string;
}

const routineChange = (routineId: string, note: string): Event => ({
  type: "proposal",
  tool: "propose_routine_change",
  summary: `Rewrite the routine (${note})`,
  input: {
    routineId,
    summary: `Rewrite the routine (${note})`,
    days: [
      {
        dayIndex: 1,
        workoutName: "ZZ Pull & Muscle-Up",
        exercises: [
          { name: "ZZ Chest to Bar Pull-ups", sets: 5, reps: "3-5", rest: 150, notes: `Max intent (${note}).` },
          { name: "ZZ Cable Row", sets: 3, reps: "10-12", rest: 90, targetLoadLbs: 90 },
        ],
      },
      { dayIndex: 3, workoutName: "ZZ Push", exercises: [{ name: "ZZ Incline Press", sets: 4, reps: "8-10" }] },
    ],
  },
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the end of an answer is never under the chat box", async ({ page, account }) => {
    // A thread long enough to scroll, already stored, so the page opens on it.
    const history = Array.from({ length: 4 }).flatMap((_, i) => [
      { role: "user", content: `ZZ question ${i}` },
      { role: "assistant", content: [{ type: "text", text: "A paragraph of coaching.\n\n".repeat(6) }] },
    ]);
    await sql`insert into coach_conversations (user_id, messages) values (${account.id}::uuid, ${sql.json(history)})`;
    const answer = "Line of a long coaching answer that wraps on a phone.\n\n".repeat(14) + "THE VERY LAST LINE.";
    await scriptChat(page, [answer.match(/[\s\S]{1,40}/g)!.map((text) => ({ type: "text", text }))]);

    await page.goto("/fit-bot/chat");
    const main = page.locator("main");
    await expect(main.getByText("ZZ question 3")).toBeVisible({ timeout: 20000 });
    await say(page, "next");
    const last = main.getByText("THE VERY LAST LINE.");
    await expect(last).toBeVisible();
    await expect(page.getByTestId("button-stop-chat")).toHaveCount(0);
    await page.waitForTimeout(1200); // let the smooth scroll settle

    // Until 2026-10-03 this line sat 30-odd pixels UNDER the composer.
    const lineBox = (await last.boundingBox())!;
    const composerBox = (await page.getByTestId("chat-composer").boundingBox())!;
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(composerBox.y + 1);
    // And the composer itself sits above the bottom nav, not behind it.
    const navBox = (await page.locator("nav.fixed").boundingBox())!;
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(navBox.y + 1);
  });
});

test("a routine card shows every day in full, and a newer version retires it", async ({ page, account }) => {
  const routineId = await seedRoutine(account.id, `ZZ Card Routine ${Date.now()}`);
  await scriptChat(page, [[routineChange(routineId, "first")], [routineChange(routineId, "second")]]);

  await page.goto("/fit-bot/chat");
  await say(page, "build me a routine");
  const cards = page.getByTestId("chat-proposal");
  await expect(cards).toHaveCount(1);

  // Not "Proposed change": what approving it does, and what it does NOT do.
  await expect(cards.first().getByTestId("text-proposal-title")).toHaveText("Update the routine");
  await expect(cards.first().getByTestId("text-proposal-consequence")).toContainText("does not start a program");
  // The whole routine: days, sets x reps, load, notes.
  await expect(cards.first().getByTestId("program-day-1")).toContainText("ZZ Pull & Muscle-Up");
  await expect(cards.first().getByTestId("program-day-1")).toContainText("5 x 3-5");
  await expect(cards.first().getByTestId("program-day-1")).toContainText("90 lbs");
  await expect(cards.first().getByText("Max intent (first).")).toBeVisible();

  await say(page, "swap the warm-up");
  await expect(cards).toHaveCount(2);
  // The first card can no longer be approved by a tap up the thread.
  await expect(cards.nth(0)).toHaveAttribute("data-status", "superseded");
  await expect(cards.nth(0).getByTestId("button-approve-proposal")).toHaveCount(0);
  await expect(cards.nth(0).getByTestId("text-proposal-status")).toContainText("Replaced");
  await expect(page.getByTestId("button-approve-proposal")).toHaveCount(1);
});

test.describe("in Los Angeles", () => {
  // West of UTC is where a bare day parsed as midnight UTC fell on the day before.
  test.use({ timezoneId: "America/Los_Angeles" });

  test("a start card says when it runs, shows the routine, and starts on THAT day", async ({ page, account }) => {
    const routineId = await seedRoutine(account.id, `ZZ Start Routine ${Date.now()}`);
    const startKey = dayFromNow(40);
    const start: Event = {
      type: "proposal",
      tool: "propose_start_routine",
      summary: "Start the routine for 2 weeks",
      input: { routineId, startDate: startKey, durationWeeks: 2, summary: "Start the routine for 2 weeks" },
    };
    await scriptChat(page, [[routineChange(routineId, "pending")], [start]]);

    await page.goto("/fit-bot/chat");
    await say(page, "rewrite it");
    await expect(page.getByTestId("chat-proposal")).toHaveCount(1);
    await say(page, "and start it");
    const card = page.getByTestId("chat-proposal").nth(1);
    await expect(card.getByTestId("text-proposal-title")).toHaveText("Start the program");
    await expect(card.getByTestId("text-proposal-start")).toContainText("runs 2 weeks");
    // The routine it will schedule, fetched as SAVED.
    await expect(card.getByTestId("proposal-start-routine")).toContainText("ZZ Pull Day");
    await expect(card.getByTestId("proposal-start-routine")).toContainText("ZZ Incline Press");
    // The rewrite above is still unapproved, and starting now would skip it.
    await expect(card.getByTestId("warning-routine-change-waiting")).toBeVisible();

    await card.getByTestId("button-approve-proposal").click();
    await expect(card).toHaveAttribute("data-status", "approved", { timeout: 20000 });

    // THE bug: "2026-10-02" was stored as Oct 1 in Los Angeles.
    const [instance] = await sql`
      select to_char(start_date, 'YYYY-MM-DD') as start_key
      from routine_instances where user_id = ${account.id}::uuid and routine_id = ${routineId}`;
    expect(instance.start_key).toBe(startKey);
    const [first] = await sql`
      select to_char(min(date), 'YYYY-MM-DD') as first_key
      from scheduled_workouts where user_id = ${account.id}::uuid`;
    expect(first.first_key).toBe(startKey);
  });

  test("moving a session puts it on the day FitBot named", async ({ page, account }) => {
    const fromKey = dayFromNow(20);
    const toKey = dayFromNow(21);
    const [row] = await sql`
      insert into scheduled_workouts (user_id, name, date, exercises)
      values (${account.id}::uuid, 'ZZ Movable Session', ${`${fromKey} 12:00:00`}::timestamp, '[]'::jsonb)
      returning id`;
    await scriptChat(page, [
      [
        {
          type: "proposal",
          tool: "propose_update_scheduled_workout",
          summary: "Move ZZ Movable Session a day later",
          input: { scheduledWorkoutId: row.id, date: toKey, summary: "Move ZZ Movable Session a day later" },
        },
      ],
    ]);

    await page.goto("/fit-bot/chat");
    await say(page, "move it a day");
    const card = page.getByTestId("chat-proposal");
    await expect(card.getByTestId("proposal-fields")).toContainText("New date");
    await card.getByTestId("button-approve-proposal").click();
    await expect(card).toHaveAttribute("data-status", "approved", { timeout: 20000 });

    // It answered 200 before too, and wrote the day it already had.
    const [moved] = await sql`select to_char(date, 'YYYY-MM-DD') as k from scheduled_workouts where id = ${row.id}`;
    expect(moved.k).toBe(toKey);
  });
});
