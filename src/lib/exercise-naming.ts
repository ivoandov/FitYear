/**
 * Canonical exercise NAMING, applied on every write.
 *
 * The catalog grew six conventions at once - equipment led in 34 names and
 * trailed in 13, 29 used " - " as a separator, parentheticals and " or "
 * alternatives were common - and that inconsistency is the root cause of
 * duplicate exercises. No fuzzy matcher can tell "the equipment moved" from
 * "this is a different movement", so near-identical names were created as
 * separate rows and fragmented Ivo's history.
 *
 * Fixing the existing catalog once is not enough: manual adds, plan imports and
 * FitBot all keep creating rows. So this runs at every creation and edit point,
 * and the one-off rename script imports it too - one definition, no drift.
 *
 * Convention (Ivo, 2026-08-27): `Equipment Modifier Movement`, title case.
 *
 * PLURALITY IS PRESERVED, deliberately. Singularizing everything is what public
 * catalogs do, but it buys nothing here: lib/exercise-match singularizes BOTH
 * sides at scoring time, so "Pushups" and "Pushup" already score 0.97 whatever
 * is stored. Rewriting names for a purely cosmetic reason would churn history
 * snapshots for no functional gain.
 *
 * This normalizes FORMAT only. It never folds one movement into another - that
 * is lib/exercise-match's job, and the duplicate guard on POST /api/exercises
 * runs after this so a reformatted name gets matched against the catalog.
 */

/** Equipment, longest-first so "Smith Machine" wins before bare "Machine". */
const EQUIPMENT: Array<[RegExp, string]> = [
  [/\bsmith(\s+machine)?\b/i, "Smith Machine"],
  [/\bez[- ]?bar\b|\bez\b/i, "EZ Bar"],
  [/\bt[- ]?bar\b/i, "T Bar"],
  [/\btrap[- ]?bar\b/i, "Trap Bar"],
  [/\b(barbells?|bb)\b/i, "Barbell"],
  [/\b(dumbbells?|dumbells?|dbs?)\b/i, "Dumbbell"],
  [/\b(kettlebells?|kbs?)\b/i, "Kettlebell"],
  [/\bcables?\b/i, "Cable"],
  [/\b(bands?|banded|mini[- ]band)\b/i, "Band"],
  [/\bmachines?\b/i, "Machine"],
  [/\bparallettes?\b/i, "Parallettes"],
  [/\bsleds?\b/i, "Sled"],
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

/**
 * Spelling of the hyphenated bodyweight movements. Ivo picked "Push-ups" as
 * the house form, so every variant converges on it while keeping singular and
 * plural distinct.
 */
const SPELLINGS: Array<[RegExp, string]> = [
  [/\bpush[\s-]?ups\b/gi, "Push-ups"],
  [/\bpush[\s-]?up\b/gi, "Push-up"],
  [/\bpull[\s-]?ups\b/gi, "Pull-ups"],
  [/\bpull[\s-]?up\b/gi, "Pull-up"],
  [/\bchin[\s-]?ups\b/gi, "Chin-ups"],
  [/\bchin[\s-]?up\b/gi, "Chin-up"],
  [/\bsit[\s-]?ups\b/gi, "Sit-ups"],
  [/\bsit[\s-]?up\b/gi, "Sit-up"],
];

/**
 * Names a mechanical rule cannot derive. A transform has no way to know that
 * "Down to Up" describes a low-to-high cable path.
 */
const OVERRIDES: Record<string, string> = {
  "cable fly - down to up": "Cable Fly Low to High",
  "cable fly - up to down": "Cable Fly High to Low",
};

const SMALL_WORDS = new Set(["to", "and", "with", "on", "in", "of", "or", "the", "a"]);

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      // Leave any word that already carries a capital beyond the first letter
      // exactly as typed. That covers acronyms (RDL, PT, EZ) and genuine mixed
      // case (McGill, ZZDedupe) - lowercasing the tail turned "ZZDedupe" into
      // "Zzdedupe", quietly rewriting a name the user chose.
      if (/[A-Z]/.test(w.slice(1))) return w;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function applySpellings(s: string): string {
  let out = s;
  for (const [re, to] of SPELLINGS) out = out.replace(re, to);
  return out;
}

/**
 * Canonical form of an exercise name. Pure, and safe to run on an
 * already-canonical name (idempotent).
 *
 * Returns the input trimmed if it cannot be parsed into anything better, so a
 * name is never destroyed - an empty or unparseable result is always worse than
 * leaving what the user typed.
 */
export function canonicalExerciseName(raw: string): string {
  const input = (raw ?? "").trim();
  if (!input) return input;

  const override = OVERRIDES[input.toLowerCase()];
  if (override) return override;

  let s = input;

  // Parentheticals are kept as MODIFIER text, not dropped: in
  // "Barbell Squat (Heel Elevated)" the qualifier IS the identity, and
  // discarding it collapses distinct variants onto one name.
  const parens: string[] = [];
  s = s.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    parens.push(String(inner).trim());
    return " ";
  });

  // " or " offers an alternative; keep the first option rather than truncating
  // the movement away entirely.
  if (/\bor\b/i.test(s)) {
    const [first] = s.split(/\bor\b/i);
    if (first.trim().split(/\s+/).filter(Boolean).length >= 2) s = first;
  }

  s = s.replace(/[–—]/g, " ").replace(/\s+-\s+/g, " ").replace(/[&/]/g, " and ");
  s = s.replace(/\s+/g, " ").trim();

  const extraFromParens = parens
    .filter((p) => p && !/^(db|bb|ohp|rdl)$/i.test(p) && p.split(/\s+/).length <= 3)
    .join(" ");
  let rest = `${s} ${extraFromParens}`;

  const equipment: string[] = [];
  for (const [re, label] of EQUIPMENT) {
    if (new RegExp(re.source, "i").test(rest)) {
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

  const coreWords = rest
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !/^(or|and|the|a|with)$/i.test(w));

  // A trailing preposition dangles once its object was pulled out as equipment
  // ("Deficit Push-Ups on Parallettes" -> "... Push-ups on").
  while (
    coreWords.length > 1 &&
    /^(on|to|with|in|at|for|from)$/i.test(coreWords[coreWords.length - 1])
  ) {
    coreWords.pop();
  }

  // Nothing recognisable left to name: keep what the user typed rather than
  // inventing something or returning an empty string.
  if (coreWords.length === 0) return applySpellings(input);

  const assembled = [...equipment, ...modifiers, ...coreWords].join(" ");
  const named = applySpellings(titleCase(assembled));

  // The column is capped at 60; if canonicalizing would overflow it, the
  // original (already validated) name is the safer thing to keep.
  if (!named || named.length > 60) return applySpellings(input).slice(0, 60);
  return named;
}
