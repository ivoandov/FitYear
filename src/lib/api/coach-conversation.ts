import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { coachConversations } from "@/lib/db/schema";
import {
  trimTranscript,
  type TranscriptMessage,
} from "@/lib/coach-transcript";

/**
 * The running conversation, stored so it survives closing the app.
 *
 * One row per user, upserted. There is no session list because this is modeled
 * as a continuous coaching relationship rather than a series of tickets: you
 * pick up where you left off, the way you would with a person.
 */

export async function loadConversation(
  userId: string,
): Promise<TranscriptMessage[]> {
  const [row] = await db
    .select()
    .from(coachConversations)
    .where(eq(coachConversations.userId, userId))
    .limit(1);
  if (!row) return [];
  // Anything could be in a jsonb column; a transcript that is not an array is
  // corrupt and starting fresh beats sending garbage to the model.
  return Array.isArray(row.messages) ? (row.messages as TranscriptMessage[]) : [];
}

export async function saveConversation(
  userId: string,
  messages: TranscriptMessage[],
): Promise<void> {
  const trimmed = trimTranscript(messages);
  await db
    .insert(coachConversations)
    .values({
      userId,
      // Drizzle serialises jsonb correctly. The trap this avoids is the raw
      // postgres.js path, where JSON.stringify into a jsonb column stores a
      // jsonb STRING rather than an array and every later read silently sees
      // the wrong shape.
      messages: trimmed,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: coachConversations.userId,
      set: { messages: trimmed, updatedAt: sql`now()` },
    });
}

export async function clearConversation(userId: string): Promise<void> {
  await db
    .delete(coachConversations)
    .where(eq(coachConversations.userId, userId));
}
