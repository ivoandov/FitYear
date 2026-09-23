import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { coachDocuments } from "@/lib/db/schema";
import {
  documentPreview,
  prepareDocument,
  type DocumentRejection,
} from "@/lib/coach-documents";

/**
 * Reading and writing the documents somebody gives their coach.
 *
 * ONE implementation, called by the API routes (the Settings screen) and by
 * FitBot's tools, for the same reason `lib/api/coach-notes.ts` is: two copies
 * of a write rule drift the first time one changes, and the rules that would
 * drift here are the length cap and the per-person ceiling, neither of which
 * announces itself when it stops being applied.
 *
 * Every function takes a userId and scopes on it. The table has a real foreign
 * key to auth.users so a deleted account takes its documents with it, but the
 * scoping is what stops one person reading another's by id - and this table can
 * hold medical records, so that is the guarantee that matters most in the app.
 */

export type CoachDocumentSummary = {
  id: string;
  title: string;
  preview: string;
  characters: number;
  source: "fitbot" | "user";
  createdAt: string;
};

export type CoachDocumentFull = CoachDocumentSummary & { content: string };

const toSummary = (row: typeof coachDocuments.$inferSelect): CoachDocumentSummary => ({
  id: row.id,
  title: row.title,
  preview: documentPreview(row.content),
  characters: row.content.length,
  source: row.source === "fitbot" ? "fitbot" : "user",
  createdAt: row.createdAt.toISOString(),
});

/** Titles and previews, newest first. Deliberately never the whole text. */
export async function listCoachDocuments(userId: string): Promise<CoachDocumentSummary[]> {
  const rows = await db
    .select()
    .from(coachDocuments)
    .where(eq(coachDocuments.userId, userId))
    .orderBy(desc(coachDocuments.createdAt));
  return rows.map(toSummary);
}

export async function getCoachDocument(
  userId: string,
  id: string,
): Promise<CoachDocumentFull | null> {
  const [row] = await db
    .select()
    .from(coachDocuments)
    .where(and(eq(coachDocuments.id, id), eq(coachDocuments.userId, userId)))
    .limit(1);
  return row ? { ...toSummary(row), content: row.content } : null;
}

export type SaveDocumentResult =
  | { ok: true; document: CoachDocumentSummary }
  | DocumentRejection;

export async function saveCoachDocument(
  userId: string,
  args: { title?: string | null; content: string; source: "fitbot" | "user"; today: string },
): Promise<SaveDocumentResult> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coachDocuments)
    .where(eq(coachDocuments.userId, userId));

  const prepared = prepareDocument({
    title: args.title,
    content: args.content,
    existingCount: Number(count ?? 0),
    today: args.today,
  });
  if (!prepared.ok) return prepared;

  const [row] = await db
    .insert(coachDocuments)
    .values({
      userId,
      title: prepared.title,
      content: prepared.content,
      source: args.source,
    })
    .returning();
  return { ok: true, document: toSummary(row) };
}

/** Returns whether a row was actually theirs to delete. */
export async function deleteCoachDocument(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(coachDocuments)
    .where(and(eq(coachDocuments.id, id), eq(coachDocuments.userId, userId)))
    .returning({ id: coachDocuments.id });
  return deleted.length > 0;
}
