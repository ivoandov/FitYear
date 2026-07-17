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
export async function exerciseCatalogPromptBlock(): Promise<string> {
  const rows = await db.select({ name: exercises.name }).from(exercises);
  const names = rows
    .map((r) => r.name.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join("; ");
  return `- THE USER'S EXERCISE LIBRARY: ${names}. When a movement you program is the same exercise as a library entry, use that entry's EXACT name (this keeps the user's history, PRs, and progress linked to one exercise). Invent a new name ONLY for a movement genuinely absent from the library.`;
}
