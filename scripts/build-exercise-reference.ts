/**
 * Regenerate `src/lib/data/exercise-reference.json` from Free Exercise DB.
 *
 *   npx tsx --env-file=.env.local scripts/build-exercise-reference.ts
 *
 * WHAT THIS IS FOR. A read-only vocabulary of standard exercise names that
 * FitBot and the app can suggest from and reconcile against. It is NOT the
 * catalog and it never becomes the catalog: nothing here is imported as a row,
 * nothing is renamed, and exercise identity is untouched. It is consulted at
 * suggestion time so a new exercise gets a canonical name instead of an
 * invented one.
 *
 * WHY THIS SOURCE. `github.com/yuhonas/free-exercise-db` is released under the
 * **Unlicense**, so the names and metadata are public domain and need nobody's
 * permission. Its IMAGES are a separate matter and are deliberately NOT used:
 * they are professional photographs of an identifiable model with no documented
 * provenance, and an Unlicense on a repository cannot launder rights its author
 * never held. Only the text comes across. See product/EXERCISE_LIBRARY_SCOPE.md
 * sections 11 and 14.
 *
 * MUSCLES ARE RESOLVED AT BUILD TIME, ON PURPOSE. The source speaks anatomical
 * lowercase ("quadriceps", "lats") and FitYear has its own two-tier taxonomy.
 * Shipping both would leave two competing vocabularies in the same app and hand
 * FitBot muscle names its own tools never return. So every muscle is run
 * through `resolveMuscle` here and the file stores FitYear coarse groups.
 *
 * Three terms the shared resolver does not know are mapped explicitly below
 * rather than added to `lib/muscle-groups.ts`: that module is on the write path
 * for every exercise in the app, and widening it to suit an import is how a
 * shared vocabulary quietly drifts. If a user ever needs to type "middle back",
 * that is a deliberate change to the resolver with its own testing.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { coarseGroupsOf } from "@/lib/muscle-groups";

const SOURCE =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";

const OUT = resolve(process.cwd(), "src/lib/data/exercise-reference.json");

/** Terms `resolveMuscle` does not carry. Mapped here, not in the shared module. */
const EXTRA: Record<string, string> = {
  abductors: "Legs",
  "middle back": "Back",
  neck: "Shoulders",
};

type Source = {
  name: string;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  mechanic: string | null;
  force: string | null;
};

function toCoarse(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const mapped = EXTRA[raw.toLowerCase()];
    if (mapped) {
      out.add(mapped);
      continue;
    }
    for (const g of coarseGroupsOf([raw])) out.add(g);
  }
  return [...out];
}

async function main() {
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`source fetch failed: ${res.status}`);
  const raw = (await res.json()) as Source[];

  const seen = new Set<string>();
  const entries = [];
  let unresolved = 0;

  for (const e of raw) {
    const key = e.name.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const muscles = toCoarse(e.primaryMuscles ?? []);
    if (muscles.length === 0 && (e.primaryMuscles ?? []).length > 0) unresolved++;

    entries.push({
      name: e.name,
      equipment: e.equipment ?? null,
      muscles,
      secondary: toCoarse(e.secondaryMuscles ?? []),
      mechanic: e.mechanic ?? null,
      force: e.force ?? null,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  // Self-verifying: an entry whose primary muscles all quarantined would be
  // unsearchable by muscle group, and silently so.
  if (unresolved > 0) {
    throw new Error(
      `${unresolved} entries lost every primary muscle to the resolver - add the term to EXTRA rather than shipping them`,
    );
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(entries));
  console.log(`wrote ${entries.length} entries to ${OUT}`);
  console.log(`size: ${(JSON.stringify(entries).length / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
