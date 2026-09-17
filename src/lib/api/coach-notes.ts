import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { coachNotes } from "@/lib/db/schema";
import { scheduledDateFromKey, scheduledDateKey } from "@/lib/date";
import {
  MAX_ACTIVE_NOTES,
  MAX_NOTE_LENGTH,
  activeNotes,
  findDuplicate,
  isCoachNoteKind,
  type CoachNoteKind,
} from "@/lib/coach-notes";

/**
 * Reading and writing FitBot's memory.
 *
 * ONE implementation, called by both the API routes (the Settings screen) and
 * the chat's write tools. The same reasoning as `lib/api/home-payload.ts`: two
 * copies of a write rule drift the first time one of them changes, and here the
 * rules that would drift are the duplicate check and the cap, neither of which
 * announces itself when it stops being applied.
 *
 * Every function takes a userId and scopes on it. `coach_notes` does have a
 * real foreign key to auth.users, unlike most of this schema, so a delete
 * cascades - but the scoping is what stops one person reading or editing
 * another's notes by id, and these rows are the most personal text in the app.
 */

export type CoachNoteDTO = {
  id: string;
  kind: CoachNoteKind;
  content: string;
  /** "YYYY-MM-DD" or null. An authored day, never an instant. */
  expiresOn: string | null;
  source: "fitbot" | "user";
  createdAt: string;
};

/**
 * Business outcomes the caller must handle, rather than exceptions.
 *
 * A duplicate and a full memory are ordinary things that happen in a working
 * conversation, not faults. Returning them lets the chat tool turn each into a
 * sentence the model can act on ("you already know that", "consolidate
 * something first") and lets the route turn it into a status code, without
 * either of them catching exceptions to read control flow.
 */
export type WriteResult =
  | { ok: true; note: CoachNoteDTO }
  | { ok: false; reason: "duplicate"; note: CoachNoteDTO }
  | { ok: false; reason: "full"; limit: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid"; message: string };

function toDTO(row: typeof coachNotes.$inferSelect): CoachNoteDTO {
  return {
    id: row.id,
    kind: row.kind as CoachNoteKind,
    content: row.content,
    expiresOn: row.expiresOn ? scheduledDateKey(row.expiresOn) : null,
    source: row.source === "user" ? "user" : "fitbot",
    createdAt: row.createdAt.toISOString(),
  };
}

/** Newest first. Includes expired notes: the Settings screen shows them. */
export async function loadCoachNotes(userId: string): Promise<CoachNoteDTO[]> {
  const rows = await db
    .select()
    .from(coachNotes)
    .where(eq(coachNotes.userId, userId))
    .orderBy(desc(coachNotes.createdAt))
    .limit(200);
  return rows.map(toDTO);
}

function validate(
  kind: unknown,
  content: unknown,
  expiresOn: unknown,
): { kind: CoachNoteKind; content: string; expires: Date | null } | string {
  if (!isCoachNoteKind(kind)) {
    return `kind must be one of goal, constraint, preference, context, agreement.`;
  }
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return "content cannot be empty.";
  if (text.length > MAX_NOTE_LENGTH) {
    return `content must be ${MAX_NOTE_LENGTH} characters or fewer.`;
  }
  let expires: Date | null = null;
  if (expiresOn != null && expiresOn !== "") {
    if (typeof expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      return "expiresOn must be a YYYY-MM-DD date.";
    }
    // Anchored the same way every other authored day in this app is, so a note
    // that expires on the 15th expires on the 15th everywhere on earth.
    expires = scheduledDateFromKey(expiresOn);
  }
  return { kind, content: text, expires };
}

export async function createCoachNote(
  userId: string,
  input: {
    kind: unknown;
    content: unknown;
    expiresOn?: unknown;
    source?: "fitbot" | "user";
  },
  todayKey: string,
): Promise<WriteResult> {
  const valid = validate(input.kind, input.content, input.expiresOn);
  if (typeof valid === "string") {
    return { ok: false, reason: "invalid", message: valid };
  }

  const existing = await loadCoachNotes(userId);

  // Checked before the cap: re-stating something already known should be a
  // no-op that says so, never the thing that reports memory as full.
  const dupe = findDuplicate(existing, valid.content);
  if (dupe) return { ok: false, reason: "duplicate", note: dupe };

  if (activeNotes(existing, todayKey).length >= MAX_ACTIVE_NOTES) {
    return { ok: false, reason: "full", limit: MAX_ACTIVE_NOTES };
  }

  const [created] = await db
    .insert(coachNotes)
    .values({
      userId,
      kind: valid.kind,
      content: valid.content,
      expiresOn: valid.expires,
      source: input.source ?? "fitbot",
    })
    .returning();

  return { ok: true, note: toDTO(created) };
}

export async function updateCoachNote(
  userId: string,
  id: string,
  input: { kind?: unknown; content?: unknown; expiresOn?: unknown },
): Promise<WriteResult> {
  const [row] = await db
    .select()
    .from(coachNotes)
    .where(and(eq(coachNotes.id, id), eq(coachNotes.userId, userId)))
    .limit(1);
  if (!row) return { ok: false, reason: "not_found" };

  const valid = validate(
    input.kind ?? row.kind,
    input.content ?? row.content,
    input.expiresOn !== undefined
      ? input.expiresOn
      : row.expiresOn
        ? scheduledDateKey(row.expiresOn)
        : null,
  );
  if (typeof valid === "string") {
    return { ok: false, reason: "invalid", message: valid };
  }

  const [updated] = await db
    .update(coachNotes)
    .set({
      kind: valid.kind,
      content: valid.content,
      expiresOn: valid.expires,
      updatedAt: new Date(),
    })
    .where(and(eq(coachNotes.id, id), eq(coachNotes.userId, userId)))
    .returning();

  return { ok: true, note: toDTO(updated) };
}

export async function deleteCoachNote(
  userId: string,
  id: string,
): Promise<WriteResult> {
  const [deleted] = await db
    .delete(coachNotes)
    .where(and(eq(coachNotes.id, id), eq(coachNotes.userId, userId)))
    .returning();
  if (!deleted) return { ok: false, reason: "not_found" };
  return { ok: true, note: toDTO(deleted) };
}
