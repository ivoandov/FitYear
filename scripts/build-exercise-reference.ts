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
 * TWO SOURCES, merged, because they barely overlap - 23 names in common out of
 * a 2,855 union. Free Exercise DB is classic barbell/dumbbell/machine work;
 * Strength to Overcome is functional, calisthenics, rings, parallettes, bands
 * and kettlebells. FitYear's own catalog straddles both, which is why no single
 * source ever covered it.
 *
 * WHY THE FIRST SOURCE. `github.com/yuhonas/free-exercise-db` is released under the
 * **Unlicense**, so the names and metadata are public domain and need nobody's
 * permission. Its IMAGES are a separate matter and are deliberately NOT used:
 * they are professional photographs of an identifiable model with no documented
 * provenance, and an Unlicense on a repository cannot launder rights its author
 * never held. Only the text comes across. See product/EXERCISE_LIBRARY_SCOPE.md
 * sections 11 and 14.
 *
 * WHY THE SECOND SOURCE, AND ITS TERMS. `strengthtoovercome.com` publishes a
 * curated spreadsheet of 3,242 functional-fitness exercises, by Jensen, a
 * trainer in Collingwood ON. It is far richer than the first source - 31
 * columns including movement pattern, plane of motion, posture, grip, laterality
 * and a hand-picked YouTube demonstration each. **It is published "for personal
 * use", and Ivo decided on 2026-09-17 to use it and not to write to Jensen.**
 * That decision is recorded here rather than buried: only the NAMES and a few
 * classification fields come across, nothing is re-hosted, and the video ids
 * play through YouTube's own embed.
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
  // Free Exercise DB
  abductors: "Legs",
  "middle back": "Back",
  neck: "Shoulders",
  // Strength to Overcome
  "hip flexors": "Legs",
  shins: "Legs",
};

/** Strength to Overcome, exported as CSV from the public Google Sheet. */
const STO_CSV =
  "https://docs.google.com/spreadsheets/d/1zMYUkfVuTkHn08iiC5KoDcMnN8hps987pJr2_2iWnGo/export?format=csv";

/**
 * The sheet's demonstration links, extracted separately and committed.
 *
 * They are NOT in the CSV export: the cells are hyperlinked text, so a CSV gives
 * the label ("Video Demonstration") and never the URL. They live in the .xlsx at
 * `xl/worksheets/_rels/sheet1.xml.rels`, which needs a zip reader this project
 * has no dependency for - so the extraction was done once, by hand, and the
 * result committed. Re-extract by downloading the .xlsx, unzipping it, and
 * pairing each `<hyperlink ref="C{row}">` with the exercise name in column B.
 */
import videoIds from "@/lib/data/sto-videos.json";

/** Minimal CSV reader: the sheet has quoted fields with commas inside. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

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

type Entry = {
  name: string;
  equipment: string | null;
  muscles: string[];
  secondary: string[];
  mechanic: string | null;
  force: string | null;
  /** A YouTube id, present only on Strength to Overcome entries. */
  videoId?: string;
};

async function main() {
  const seen = new Set<string>();
  const entries: Entry[] = [];
  let unresolved = 0;

  // ---- Source 1: Free Exercise DB (public domain) ----
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`free-exercise-db fetch failed: ${res.status}`);
  const raw = (await res.json()) as Source[];

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
  const fromFedb = entries.length;

  // ---- Source 2: Strength to Overcome (functional) ----
  const csvRes = await fetch(STO_CSV);
  if (!csvRes.ok) throw new Error(`strengthtoovercome fetch failed: ${csvRes.status}`);
  const rows = parseCSV(await csvRes.text());

  // Find the header by name rather than a fixed row: the sheet carries a
  // preamble of notes above it, and that preamble grows with each version.
  const headerRow = rows.findIndex((r) => r.some((c) => c.trim() === "Exercise"));
  if (headerRow < 0) throw new Error("could not find the Exercise header row");
  const head = rows[headerRow].map((c) => c.trim());
  const at = (label: string) => head.findIndex((c) => c === label);

  const cName = at("Exercise");
  const cTarget = at("Target Muscle Group");
  const cSecondary = at("Secondary Muscle");
  const cEquip = at("Primary Equipment");
  const cMech = at("Mechanics");
  const cForce = at("Force Type");
  if (cName < 0 || cTarget < 0) throw new Error("the sheet's columns have moved");

  const videos = videoIds as Record<string, string>;
  let fromSto = 0;

  for (const r of rows.slice(headerRow + 1)) {
    const name = (r[cName] ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue; // Free Exercise DB wins a collision: it is the source with no licence question.
    seen.add(key);

    const muscles = toCoarse([(r[cTarget] ?? "").trim()].filter(Boolean));
    if (muscles.length === 0 && (r[cTarget] ?? "").trim()) unresolved++;

    const mech = (r[cMech] ?? "").trim().toLowerCase();
    const force = (r[cForce] ?? "").trim().toLowerCase();

    entries.push({
      name,
      equipment: (r[cEquip] ?? "").trim() || null,
      muscles,
      secondary: toCoarse([(r[cSecondary] ?? "").trim()].filter(Boolean)),
      // Normalised to the same vocabulary the first source uses, so a consumer
      // never has to know which source an entry came from.
      mechanic: mech === "compound" || mech === "isolation" ? mech : null,
      force: force === "push" || force === "pull" || force === "static" ? force : null,
      ...(videos[name] ? { videoId: videos[name] } : {}),
    });
    fromSto++;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`free-exercise-db: ${fromFedb}`);
  console.log(`strengthtoovercome: ${fromSto} new (collisions kept the public-domain entry)`);
  console.log(`with a demonstration video: ${entries.filter((e) => e.videoId).length}`);

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
