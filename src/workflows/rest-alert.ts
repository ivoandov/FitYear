import { sleep } from "workflow";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { restNotifications } from "@/lib/db/schema";
import { sendPushToUser } from "@/lib/push-server";

/**
 * Delivers the "rest is over" alert to a CLOSED app.
 *
 * Web Push has no delayed-delivery primitive and Hobby cron only fires daily,
 * so the delay lives here: the workflow sleeps for the rest duration without
 * holding compute, then sends. The in-app timer still fires its own local
 * notification when the app is open; this is the path for when iOS has
 * suspended or discarded the page.
 */

/**
 * Send only if the rest is still pending. Skipping a set early (or finishing
 * with the app open) flips the row to `cancelled`, so a stale buzz never
 * arrives minutes later for a rest the user already moved past.
 */
async function deliverIfStillPending(restId: string): Promise<{ sent: number; skipped: boolean }> {
  "use step";

  const [row] = await db
    .select()
    .from(restNotifications)
    .where(eq(restNotifications.id, restId))
    .limit(1);

  if (!row || row.status !== "pending") return { sent: 0, skipped: true };

  const sent = await sendPushToUser(row.userId, {
    title: "Rest complete",
    body: row.exerciseName ? `Time for your next ${row.exerciseName} set.` : "Time for your next set.",
    url: "/track",
  });

  // Guarded on `pending` so a cancel landing mid-send still wins the race.
  await db
    .update(restNotifications)
    .set({ status: "sent" })
    .where(and(eq(restNotifications.id, restId), eq(restNotifications.status, "pending")));

  return { sent, skipped: false };
}

export async function restAlertWorkflow(restId: string, delaySeconds: number) {
  "use workflow";

  await sleep(`${delaySeconds}s`);
  return await deliverIfStillPending(restId);
}
