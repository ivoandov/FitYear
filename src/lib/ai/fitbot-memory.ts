import { saveCoachDocument } from "@/lib/api/coach-documents";
import { MAX_DOCUMENT_LENGTH } from "@/lib/coach-documents";
import {
  createCoachNote,
  deleteCoachNote,
  loadCoachNotes,
  updateCoachNote,
  type WriteResult,
} from "@/lib/api/coach-notes";

/**
 * Running FitBot's memory tools.
 *
 * These are the only tools in the loop that write, and they write through the
 * same helpers the Settings screen uses - see the header of fitbot-tools.ts for
 * why the proposal rule does not apply to them.
 *
 * Every outcome comes back as a SENTENCE rather than a status. A tool result is
 * read by a model, and "That is already in your memory, no need to note it
 * again" produces a better next turn than `{"ok":false,"reason":"duplicate"}`,
 * which invites it to retry or to apologise to the user about an internal
 * detail they cannot see and do not care about.
 */

function describe(result: WriteResult, verb: string): string {
  if (result.ok) {
    return `${verb} "${result.note.content}" (id ${result.note.id}). Mention to them what you noted.`;
  }
  switch (result.reason) {
    case "duplicate":
      return `You already know that - it is stored as "${result.note.content}" (id ${result.note.id}). Nothing was added. If the new wording is genuinely different, update that note instead of adding a second one.`;
    case "full":
      return `Your memory is full at ${result.limit} notes. Nothing was added. Look at what you are holding, forget anything stale, or combine several related notes into one, then try again.`;
    case "not_found":
      return `There is no note with that id. Check the ids in your memory rather than guessing one.`;
    case "invalid":
      return `That was not valid: ${result.message}`;
  }
}

export async function runMemoryTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { userId: string; todayKey: string },
): Promise<string> {
  switch (name) {
    case "remember":
      return describe(
        await createCoachNote(
          ctx.userId,
          {
            kind: input.kind,
            content: input.content,
            expiresOn: input.expiresOn,
            source: "fitbot",
          },
          ctx.todayKey,
        ),
        "Noted",
      );

    case "update_memory": {
      const id = String(input.id ?? "");
      if (!id) return "You must give the id of the note to update.";
      return describe(
        await updateCoachNote(ctx.userId, id, {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.expiresOn !== undefined ? { expiresOn: input.expiresOn } : {}),
        }),
        "Updated to",
      );
    }

    case "forget": {
      const id = String(input.id ?? "");
      if (!id) return "You must give the id of the note to forget.";
      const result = await deleteCoachNote(ctx.userId, id);
      if (!result.ok) {
        return "There is no note with that id. Check the ids in your memory rather than guessing one.";
      }
      return `Forgotten: "${result.note.content}". Tell them you dropped it.`;
    }

    case "save_document": {
      const content = typeof input.content === "string" ? input.content : "";
      const result = await saveCoachDocument(ctx.userId, {
        title: typeof input.title === "string" ? input.title : null,
        content,
        source: "fitbot",
        today: ctx.todayKey,
      });
      if (result.ok) {
        return `Saved "${result.document.title}" (id ${result.document.id}) to their documents, ${result.document.characters} characters. It is kept whole and you can read it again with read_document. Now write down what it CHANGES about their training as notes - the document itself is never in front of you unless you go and read it.`;
      }
      switch (result.reason) {
        case "full":
          return `Their document library is full. Nothing was saved. List what is there and ask which one to drop.`;
        case "too_long":
          return `That is longer than ${MAX_DOCUMENT_LENGTH} characters, so it was not saved. Ask them to paste it in parts, or save the part that matters.`;
        case "empty":
          return `There was no text to save.`;
      }
      break;
    }

    default:
      return `Unknown memory tool "${name}".`;
  }
}

export { loadCoachNotes };
