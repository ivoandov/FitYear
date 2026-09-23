/**
 * Documents somebody hands their coach: an MRI report in anatomical language, a
 * physio's summary, a blood panel, a programme from a previous gym.
 *
 * WHY THIS EXISTS SEPARATELY FROM MEMORY. A note is a FACT the coach plans
 * around ("no loaded lumbar flexion, L5-S1 extrusion") and it lives in the
 * system prompt, so it has to stay short and there is a ceiling on how many
 * make sense. A report is a SOURCE: long, clinical, mostly irrelevant to
 * training until it is not, and worth keeping verbatim because nobody can
 * distil it perfectly the first time and the wording is what their clinician
 * will recognise. Ivo, 2026-09-22, asking for exactly this: "hey I have
 * sciatica or L5 S1 herniation diagnosis - here are the results - so plan my
 * program around it."
 *
 * So: the report is stored whole and never rendered into the prompt, and what
 * reaches the prompt is the notes the coach wrote from it. The coach can go
 * back and read the source months later, when the question has changed.
 */

/** How many documents one person may keep. */
export const MAX_DOCUMENTS = 25;

/**
 * Characters in one document. A long radiology report runs to a few thousand;
 * this leaves room for somebody pasting a whole discharge summary, and stops a
 * runaway paste becoming a row nothing can render.
 */
export const MAX_DOCUMENT_LENGTH = 40_000;

/** Characters in a title. */
export const MAX_DOCUMENT_TITLE = 120;

/**
 * What a listing shows: enough to tell two reports apart, and nothing like
 * enough to make listing them expensive. `list_documents` is a cheap question
 * and `read_document` is the expensive one, deliberately.
 */
export const PREVIEW_LENGTH = 200;

export function documentPreview(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_LENGTH) return flat;
  return `${flat.slice(0, PREVIEW_LENGTH).trimEnd()}...`;
}

export type DocumentRejection =
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "too_long"; limit: number }
  | { ok: false; reason: "full"; limit: number };

export type DocumentAccepted = { ok: true; title: string; content: string };

/**
 * Validate before writing, returning outcomes rather than throwing.
 *
 * Same shape as the note writer, for the same reason: "your document library
 * is full" and "that is too long to store" are ordinary answers a coach can say
 * in a sentence, not faults. A missing title is filled rather than refused -
 * somebody pasting a report mid-conversation should not lose it to a naming
 * requirement.
 */
export function prepareDocument(args: {
  title?: string | null;
  content: string;
  existingCount: number;
  today: string;
}): DocumentAccepted | DocumentRejection {
  const content = args.content?.trim() ?? "";
  if (!content) return { ok: false, reason: "empty" };
  if (content.length > MAX_DOCUMENT_LENGTH) {
    return { ok: false, reason: "too_long", limit: MAX_DOCUMENT_LENGTH };
  }
  if (args.existingCount >= MAX_DOCUMENTS) {
    return { ok: false, reason: "full", limit: MAX_DOCUMENTS };
  }
  const given = (args.title ?? "").trim();
  const title = (given || `Document ${args.today}`).slice(0, MAX_DOCUMENT_TITLE);
  return { ok: true, title, content };
}
