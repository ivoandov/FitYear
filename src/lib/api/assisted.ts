import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { exercises } from "@/lib/db/schema";

/**
 * Whether an exercise inside a routine or a scheduled session is ASSISTED.
 *
 * Read from the CATALOG, not from the copy carried inline: the 2026-07-29
 * gotcha is that the flag on a copy was never reliably written, so every
 * surface trusting it inverted assisted lifts. Routine exercises are copies of
 * a template's, which are copies of the catalog at the time the template was
 * made - two steps from the truth.
 *
 * Matches by id first and by name second, because a FitBot or imported entry
 * is stored NAME-only. The assisted rows are a handful out of the whole shared
 * catalog, so loading all of them once is cheaper than building a scoped query
 * out of every exercise in a routine.
 */
export async function loadAssistedCheck(): Promise<(ex: Record<string, unknown>) => boolean> {
  const rows = await db
    .select({ id: exercises.id, name: exercises.name })
    .from(exercises)
    .where(eq(exercises.isAssisted, true));
  const ids = new Set(rows.map((r) => r.id));
  const names = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  return (ex) => {
    if (ex.isAssisted === true) return true;
    if (typeof ex.id === "string" && ids.has(ex.id)) return true;
    return typeof ex.name === "string" && names.has(ex.name.trim().toLowerCase());
  };
}
