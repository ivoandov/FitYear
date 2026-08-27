/**
 * REPORT ONLY - proposes a canonical name for every catalog exercise. Writes
 * nothing, ever. The approved output feeds a separate rename migration.
 *
 * Target convention (Ivo, 2026-08-27): `Equipment Modifier Movement`, singular,
 * title case. The catalog currently uses at least six conventions at once -
 * equipment leads in 34 names and trails in 13, 29 use " - " as a separator,
 * 82 are plural - and that inconsistency is the root cause of the import
 * duplicates, because no fuzzy matcher can tell "the equipment moved" from
 * "this is a different movement".
 *
 * WHAT A FIRST NAIVE PASS GOT WRONG, and why this one is shaped as it is:
 *   - "Barbell Squats - Smith Machine" became "Barbell Machine Smith Machine
 *     Squat": equipment was matched twice and not deduped.
 *   - "Cable or Banded External Rotations" became "Cable": truncating at " or "
 *     ate the movement itself.
 *   - "Barbell Squat (Glute Focused)" and "(Heel Elevated)" BOTH became
 *     "Barbell Squat", colliding with each other and with the real row. Those
 *     parentheticals ARE the identity, so they are kept as modifiers.
 *
 * Collisions are therefore treated as failures, not warnings: any proposal that
 * is not unique is reported and excluded from the approvable list.
 *
 *   npx tsx --env-file=.env.local scripts/propose-exercise-renames.ts
 *   npx tsx --env-file=.env.local scripts/propose-exercise-renames.ts --group=Chest
 */
import postgres from "postgres";
import { coarseGroupsOf } from "@/lib/muscle-groups";

/** Equipment, longest-first so "Smith Machine" wins before bare "Machine". */
const EQUIPMENT: Array<[RegExp, string]> = [
  [/\bsmith(\s+machine)?\b/i, "Smith Machine"],
  [/\bez[- ]?bar\b|\bez\b/i, "EZ Bar"],
  [/\b(barbells?|bb)\b/i, "Barbell"],
  [/\b(dumbbells?|dumbells?|dbs?)\b/i, "Dumbbell"],
  [/\b(kettlebells?|kbs?)\b/i, "Kettlebell"],
  [/\bcables?\b/i, "Cable"],
  [/\b(bands?|banded|mini[- ]band)\b/i, "Band"],
  [/\bmachines?\b/i, "Machine"],
  [/\bparallettes?\b/i, "Parallettes"],
  [/\bsleds?\b/i, "Sled"],
  [/\bt[- ]?bar\b/i, "T Bar"],
  [/\btrap[- ]?bar\b/i, "Trap Bar"],
];

/** Position / grip / stance qualifiers, longest-first. */
const MODIFIERS: string[] = [
  "Half Kneeling", "Chest Supported", "Bent Over", "Single Leg", "Single Arm",
  "Neutral Grip", "Wide Grip", "Close Grip", "Reverse Grip", "Stacked Wrists",
  "Feet Elevated", "Heel Elevated", "Glute Focused", "Cross Body", "Crossbody",
  "B Stance", "Seated", "Standing", "Incline", "Decline", "Flat", "Kneeling",
  "Prone", "Supine", "Lying", "Assisted", "Deficit", "Explosive", "Eccentric",
  "Isometric", "Strict", "Tempo", "Barefoot", "Nordic", "Bulgarian", "Split",
  "Front", "Back", "Overhead", "Rear Delt", "Lateral", "Conventional", "Romanian",
];

// Retained for reference only; plurality is deliberately preserved (see
// proposeName). Kept so the decision is visible rather than silently lost.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function singularizeWord(w: string): string {
  if (/ies$/i.test(w) && w.length > 4) return w.slice(0, -3) + "y";
  if (/sses$/i.test(w)) return w.slice(0, -2);
  if (/ches$|shes$|xes$/i.test(w)) return w.slice(0, -2);
  if (/es$/i.test(w) && w.length > 4 && !/ss$/i.test(w.slice(0, -2))) return w.slice(0, -1);
  if (/s$/i.test(w) && !/ss$|us$|is$/i.test(w)) return w.slice(0, -1);
  return w;
}

function titleCase(s: string): string {
  const small = new Set(["to", "and", "with", "on", "in", "of", "or", "the", "a"]);
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      if (/^[A-Z]{2,}$/.test(w)) return w; // keep acronyms like RDL, PT
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export interface Proposal {
  id: string;
  current: string;
  proposed: string;
  history: number;
  groups: string[];
  /** Populated when the proposal is unsafe to apply. */
  problem?: string;
}

/**
 * Names Ivo has ruled on directly. These bypass the mechanical transform
 * entirely - a rule cannot know that "Down to Up" means "Low to High".
 */
const OVERRIDES: Record<string, string> = {
  "Cable Fly - Down to Up": "Cable Fly Low to High",
  "Cable Fly - Up to Down": "Cable Fly High to Low",
  "Knee Pushups": "Knee Push Ups",
};

/**
 * Plurality is PRESERVED, not normalized.
 *
 * An earlier pass singularized every name, which is the convention most public
 * exercise catalogs use - but it buys nothing here and Ivo prefers plural for
 * some movements. lib/exercise-match singularizes BOTH sides at scoring time,
 * so "Pushups" and "Pushup" already score 0.97 against each other whatever is
 * stored. Rewriting 82 names for a purely cosmetic reason would have churned
 * history snapshots for no functional gain.
 */
export function proposeName(original: string): { proposed: string; problem?: string } {
  const override = OVERRIDES[original];
  if (override) return { proposed: override };

  let s = original.trim();

  // Parentheticals are kept as MODIFIER text, not discarded: for
  // "Barbell Squat (Heel Elevated)" the qualifier is the identity.
  const parens: string[] = [];
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    parens.push(String(inner).trim());
    return " ";
  });

  // " or " offers an alternative. Keep the FIRST option and drop the rest -
  // truncating everything after it deleted the movement entirely.
  if (/\bor\b/i.test(s)) {
    const [first] = s.split(/\bor\b/i);
    if (first.trim().split(/\s+/).filter(Boolean).length >= 2) s = first;
  }

  s = s.replace(/[-–—]/g, " ").replace(/[&/]/g, " and ").replace(/\s+/g, " ").trim();

  const extraFromParens = parens
    .filter((p) => p && !/^(db|bb|ohp|rdl)$/i.test(p) && p.split(/\s+/).length <= 3)
    .join(" ");
  const haystack = `${s} ${extraFromParens}`;

  // Equipment, deduped and longest-first so Smith Machine suppresses Machine.
  const equipment: string[] = [];
  let rest = haystack;
  for (const [re, label] of EQUIPMENT) {
    const g = new RegExp(re.source, "gi");
    if (g.test(rest)) {
      if (!equipment.includes(label)) equipment.push(label);
      rest = rest.replace(new RegExp(re.source, "gi"), " ");
    }
  }
  if (equipment.includes("Smith Machine")) {
    const i = equipment.indexOf("Machine");
    if (i >= 0) equipment.splice(i, 1);
  }

  const modifiers: string[] = [];
  for (const m of MODIFIERS) {
    const re = new RegExp("\\b" + m.replace(/ /g, "[ -]?") + "\\b", "i");
    if (re.test(rest)) {
      if (!modifiers.includes(m)) modifiers.push(m);
      rest = rest.replace(new RegExp(re.source, "gi"), " ");
    }
  }

  // A leftover conjunction from an "or"/"and" phrase is noise once the
  // alternatives have been folded into equipment - "Cable Band or External
  // Rotation" is not a name.
  const coreWords = rest
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(or|and|the|a|with)$/i.test(w));
  // A trailing preposition is left dangling once its object was pulled out as
  // equipment: "Deficit Push-Ups on Parallettes" became "... Push Ups on".
  // Mid-phrase ones are meaningful ("Cable Fly Down to Up") and are kept.
  while (coreWords.length > 1 && /^(on|to|with|in|at|for|from)$/i.test(coreWords[coreWords.length - 1])) {
    coreWords.pop();
  }
  if (coreWords.length === 0) {
    // Everything was consumed as equipment/modifier: there is no movement left
    // to name, so this one needs a human.
    return { proposed: "", problem: "no movement word left after parsing" };
  }

  const proposed = titleCase([...equipment, ...modifiers, ...coreWords].join(" "));
  if (!proposed) return { proposed: "", problem: "empty proposal" };
  if (proposed.length > 60) return { proposed, problem: "exceeds the 60-char name cap" };
  return { proposed };
}

async function main() {
  const onlyGroup = process.argv.find((a) => a.startsWith("--group="))?.split("=")[1];
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = (await sql`
    select e.id, e.name, e.muscle_groups,
      (select count(*)::int from workout_exercises we where we.exercise_id = e.id) as hist
      from exercises e order by e.name`) as any[];

  const all: Proposal[] = rows.map((r) => {
    const { proposed, problem } = proposeName(r.name);
    const groups = coarseGroupsOf(Array.isArray(r.muscle_groups) ? r.muscle_groups : []);
    return { id: r.id, current: r.name, proposed, history: r.hist, groups, problem };
  });

  // Collision detection across the FINAL names, including rows that are not
  // changing - a rename must not land on a name that already exists.
  const finalName = new Map<string, Proposal[]>();
  for (const p of all) {
    const key = (p.proposed || p.current).toLowerCase();
    if (!finalName.has(key)) finalName.set(key, []);
    finalName.get(key)!.push(p);
  }
  for (const [, group] of finalName) {
    if (group.length > 1) {
      for (const p of group) {
        p.problem = `collides with ${group.filter((g) => g !== p).map((g) => JSON.stringify(g.current)).join(", ")}`;
      }
    }
  }

  const changing = all.filter((p) => p.proposed && p.proposed !== p.current);
  const safe = changing.filter((p) => !p.problem);
  const blocked = all.filter((p) => p.problem);

  console.log(`${all.length} exercises`);
  console.log(`  ${all.length - changing.length} already conform`);
  console.log(`  ${safe.length} safe to rename`);
  console.log(`  ${blocked.length} BLOCKED (need a human decision)\n`);

  const byGroup = new Map<string, Proposal[]>();
  for (const p of safe) {
    const g = p.groups[0] ?? "Other";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(p);
  }

  for (const [g, items] of [...byGroup.entries()].sort()) {
    if (onlyGroup && g.toLowerCase() !== onlyGroup.toLowerCase()) continue;
    console.log(`\n=== ${g} (${items.length}) ===`);
    for (const p of items) {
      console.log(`  ${JSON.stringify(p.current).padEnd(48)} -> ${JSON.stringify(p.proposed).padEnd(46)} hist=${p.history}`);
    }
  }

  if (!onlyGroup && blocked.length) {
    console.log(`\n=== BLOCKED - not renaming these without a decision ===`);
    for (const p of blocked) {
      console.log(`  ${JSON.stringify(p.current).padEnd(48)} -> ${JSON.stringify(p.proposed || "(none)").padEnd(30)} ${p.problem}`);
    }
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
