import { describe, it, expect } from "vitest";
import {
  MAX_DOCUMENTS,
  MAX_DOCUMENT_LENGTH,
  MAX_DOCUMENT_TITLE,
  PREVIEW_LENGTH,
  documentPreview,
  prepareDocument,
} from "@/lib/coach-documents";

describe("documentPreview", () => {
  it("flattens a report into one readable line", () => {
    // Reports arrive with hard line breaks and indentation from a PDF copy.
    // A listing wants one line per document, not the original layout.
    expect(documentPreview("MRI LUMBAR SPINE\n\n  FINDINGS:   L5-S1  extrusion")).toBe(
      "MRI LUMBAR SPINE FINDINGS: L5-S1 extrusion",
    );
  });

  it("cuts a long document to a preview", () => {
    const preview = documentPreview("x".repeat(PREVIEW_LENGTH + 500));
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_LENGTH + 3);
    expect(preview.endsWith("...")).toBe(true);
  });

  it("leaves a short one whole, with no trailing dots", () => {
    expect(documentPreview("Physio: cleared to lift")).toBe("Physio: cleared to lift");
  });
});

describe("prepareDocument", () => {
  const base = { existingCount: 0, today: "2026-09-22" };

  it("keeps the document exactly as it was given", () => {
    // The wording is the point: a clinician recognises their own report, and a
    // tidied-up version is a different document.
    const content = "IMPRESSION:\n1. L5-S1 left paracentral disc extrusion.";
    const result = prepareDocument({ ...base, title: "Lumbar MRI", content });
    expect(result).toEqual({ ok: true, title: "Lumbar MRI", content });
  });

  it("names an untitled document rather than refusing it", () => {
    // Somebody pasting a report mid-conversation should not lose it to a
    // naming requirement.
    const result = prepareDocument({ ...base, title: "  ", content: "Report text" });
    expect(result).toEqual({ ok: true, title: "Document 2026-09-22", content: "Report text" });
  });

  it("trims a title past the limit instead of failing", () => {
    const result = prepareDocument({ ...base, title: "T".repeat(500), content: "x" });
    expect(result.ok && result.title.length).toBe(MAX_DOCUMENT_TITLE);
  });

  it("refuses an empty document", () => {
    expect(prepareDocument({ ...base, title: "Empty", content: "   " })).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses one past the length cap, and says what the cap is", () => {
    expect(
      prepareDocument({ ...base, title: "Huge", content: "x".repeat(MAX_DOCUMENT_LENGTH + 1) }),
    ).toEqual({ ok: false, reason: "too_long", limit: MAX_DOCUMENT_LENGTH });
  });

  it("refuses when the library is full", () => {
    expect(
      prepareDocument({ ...base, existingCount: MAX_DOCUMENTS, title: "One more", content: "x" }),
    ).toEqual({ ok: false, reason: "full", limit: MAX_DOCUMENTS });
  });

  it("allows the document that exactly reaches the cap", () => {
    // Off-by-one here would reject a report that fits.
    const result = prepareDocument({ ...base, title: "Exact", content: "x".repeat(MAX_DOCUMENT_LENGTH) });
    expect(result.ok).toBe(true);
  });
});

describe("houseDashes on a note", () => {
  it("replaces a prose dash with a spaced hyphen", async () => {
    const { houseDashes } = await import("@/lib/coach-notes");
    expect(houseDashes("L4-L5 bulge \u2014 confirmed on MRI")).toBe(
      "L4-L5 bulge - confirmed on MRI",
    );
  });

  it("keeps a dash that is INPUT rather than prose", async () => {
    // Between characters it is a range or a spinal level, not punctuation:
    // the exact distinction a blanket sweep once got wrong in a regex class.
    const { houseDashes } = await import("@/lib/coach-notes");
    expect(houseDashes("8\u201312 reps at L5\u2013S1")).toBe("8-12 reps at L5-S1");
  });

  it("leaves ordinary text alone", async () => {
    const { houseDashes } = await import("@/lib/coach-notes");
    expect(houseDashes("No loaded lumbar flexion - physio cleared lifting")).toBe(
      "No loaded lumbar flexion - physio cleared lifting",
    );
  });
});
