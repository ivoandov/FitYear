import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";

/**
 * Prompt block listing every catalog exercise name, injected into the FitBot
 * generation prompts (single workout, refine, program skeleton anchors, program
 * phase accessories) so the model names movements canonically at the source.
 *
 * The reconcile matcher stays as the backstop, but it deliberately refuses
 * equipment-word variants ("Cable Face Pull" vs "Face Pulls" scores below the
 * threshold because that same distance also separates genuinely different
 * movements), so generation-time reuse is the only reliable way to stop those
 * near-duplicates from being minted.
 */
// The catalog is SHARED, so every user's exercise names end up in every other
// user's prompt. Bound both dimensions: a single name cannot dominate (or carry
// instructions to the model), and the list cannot grow the prompt without limit
// as the library does.
const MAX_NAME_CHARS = 60;
const MAX_NAMES = 400;

export async function exerciseCatalogPromptBlock(): Promise<string> {
  const rows = await db.select({ name: exercises.name }).from(exercises);
  const names = rows
    .map((r) => r.name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_CHARS))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_NAMES)
    .join("; ");
  return `- THE USER'S EXERCISE LIBRARY: ${names}. When a movement you program is the same exercise as a library entry, use that entry's EXACT name (this keeps the user's history, PRs, and progress linked to one exercise). Invent a new name ONLY for a movement genuinely absent from the library.`;
}
