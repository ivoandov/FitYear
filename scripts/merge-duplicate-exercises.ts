/**
 * One-shot, idempotent exercise-catalog dedupe + muscle-data repair
 * (Ivo-reviewed merge list, 2026-07-17).
 *
 * Does, in one transaction:
 *  1. MERGES: folds each approved duplicate exercise into its surviving row -
 *     repoints workout_exercises history + pr_history + exercise_goals,
 *     rewrites inline jsonb refs (workout_templates, scheduled_workouts,
 *     routine_entries, active_workouts) by id AND by normalized name, renames
 *     the survivor where Ivo chose a new canonical name, sets its final muscle
 *     list, then deletes the absorbed rows. History name snapshots are left
 *     as-is on purpose (they record what the exercise was called at the time).
 *  2. MUSCLE REPAIR: decodes the double-encoded jsonb-string muscle_groups
 *     rows (July-era wart), normalizes every catalog row through
 *     normalizeMuscleGroups (nested "Legs (Hamstrings)" tags expand), and
 *     hand-fills the rows the old quarantine emptied ([] rows) with
 *     Ivo-reviewed muscle lists (only while they are still empty).
 *  3. NAME TRIMS: strips leading/trailing/doubled whitespace from catalog
 *     names ("Lateral Raises " -> "Lateral Raises"), skipping any trim that
 *     would collide with an existing name.
 *  4. ORPHAN HEAL: the 42 legacy (Jan/Feb 2026 backfill) workout_exercises
 *     rows with an EMPTY exercise_id relink to the catalog by name snapshot,
 *     resolved through the ORIGINAL name -> surviving id mapping so renames
 *     and merges are honored.
 *  5. SNAPSHOT HEAL: workout_exercises.muscle_groups_snapshot rows that are
 *     non-array / empty / display-format are normalized (or refilled from the
 *     repaired catalog row when empty) so the Insights muscle rollup can read
 *     every workout again.
 *
 * Safety:
 *  - DRY-RUN by default; pass --apply to write.
 *  - The DB RDL pair (flagged for Ivo mid-review) only merges with
 *    --include-pending; without it the pair is reported but untouched.
 *  - Backs up every affected row to a gitignored JSON file before writing.
 *  - Single transaction; self-verifies after apply (absorbed ids unreferenced,
 *    all muscle_groups arrays, survivor names in place); a re-run finds 0
 *    changes (idempotent).
 *
 *   npx tsx --env-file=.env.local scripts/merge-duplicate-exercises.ts                       # dry-run
 *   npx tsx --env-file=.env.local scripts/merge-duplicate-exercises.ts --apply               # write approved set
 *   npx tsx --env-file=.env.local scripts/merge-duplicate-exercises.ts --apply --include-pending
 */
import postgres from "postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeMuscleGroups } from "../src/lib/muscle-groups";
import { normalizeExerciseName, matchExercise } from "../src/lib/exercise-match";

type Sql = ReturnType<typeof postgres>;

interface MergeSpec {
  keepId: string;
  /** Survivor's name after the merge (Ivo's canonical pick). */
  finalName: string;
  /** Survivor's final muscle list (already-canonical labels). */
  finalMuscles: string[];
  absorb: Array<{ id: string; name: string }>;
  /** Survivor's name BEFORE the merge, for inline name-ref rewriting. */
  keepName: string;
  note: string;
}

// Ivo's approved merge list (conversation 2026-07-17).
const MERGES: MergeSpec[] = [
  {
    keepId: "7",
    keepName: "Shoulder Press",
    finalName: "DB Shoulder Press - Standing",
    finalMuscles: ["Shoulders", "Triceps"],
    absorb: [{ id: "d78e576c-c690-4b4c-808b-18c4f39d99a2", name: "Dumbbell Shoulder Press" }],
    note: "generic Shoulder Press was standing DB in practice; renamed per Ivo",
  },
  {
    keepId: "31920966-55da-4be5-bd9b-2c14cc5b5bdd",
    keepName: "Seated Dumbbell Shoulder Press",
    finalName: "DB Shoulder Press - Seated",
    finalMuscles: ["Front Delts", "Side Delts", "Triceps"],
    absorb: [{ id: "1c26196f-301e-498a-8747-106bdfe467ac", name: "Seated DB Shoulder Press" }],
    note: "the two seated DB variants, renamed per Ivo",
  },
  {
    keepId: "ce787d57-62aa-47c3-8f85-5d299db8bc98",
    keepName: "Shoulder Press - Seated",
    finalName: "Shoulder Press - Seated",
    finalMuscles: ["Shoulders"],
    absorb: [{ id: "c5ac6220-c212-4b3a-9e12-8817a9c5ff11", name: "Shoulder Press - Seated" }],
    note: "exact-name duplicate of the library row",
  },
  {
    keepId: "02be1131-7cc8-406d-9fd1-5e69055eb36b",
    keepName: "Chest Supported Row",
    finalName: "Chest Supported DB Row",
    finalMuscles: ["Upper Back", "Lats", "Rear Delts", "Biceps"],
    absorb: [{ id: "fec4b28b-4e9c-44f4-a3e6-5ccf36f3ef19", name: "Chest-Supported DB Row" }],
    note: "Ivo: keep the more specific name",
  },
  {
    keepId: "8",
    keepName: "Bicep Curls",
    finalName: "Bicep Curls",
    finalMuscles: ["Biceps"],
    absorb: [{ id: "c63dba13-9a45-4205-9f02-9fd175b753ba", name: "DB Bicep Curl" }],
    note: "DB variant into the generic curl (Ivo: sounds good)",
  },
  {
    keepId: "714d7cab-7166-4678-b0a4-3fcc86c9486a",
    keepName: "Face Pulls",
    finalName: "Face Pulls",
    finalMuscles: ["Upper Back", "Rear Delts", "Rotator Cuff"],
    absorb: [{ id: "1ebdf7cf-dff2-4688-b413-1f86ad958bfc", name: "Cable Face Pull" }],
    note: "face pulls are a cable movement; specifics from Cori's copy",
  },
  {
    keepId: "ce3c24f9-dc9d-4646-9b23-e3797e859034",
    keepName: "Dumbbell Walking Lunge",
    finalName: "DB Walking Lunge",
    finalMuscles: ["Quads", "Glutes", "Hamstrings"],
    absorb: [{ id: "aef0f5d8-dd1f-4040-acae-16dad7c3c7c4", name: "Walking Lunges" }],
    note: "Ivo: keep the more specific DB name",
  },
  {
    keepId: "35f43e8f-9494-4cc2-b3ba-41a5d35bb7a0",
    keepName: "Lateral Raises ",
    finalName: "Lateral Raises",
    finalMuscles: ["Side Delts"],
    absorb: [{ id: "47bb7d46-3072-41b8-9727-cf723543f55e", name: "DB Lateral Raise" }],
    note: "trailing space trimmed; Cori's scheduled ref repointed (data kept)",
  },
];

// Found mid-review (the upgraded matcher flags it); merges only with
// --include-pending after Ivo confirms.
const PENDING_MERGES: MergeSpec[] = [
  {
    keepId: "cc0c75bc-8dbd-4107-8d42-29e36a9f3214",
    keepName: "DB Romanian Deadlift",
    finalName: "DB Romanian Deadlift",
    finalMuscles: ["Hamstrings", "Glutes", "Lower Back"],
    absorb: [{ id: "d17823af-c9cc-4914-b872-574a303158ee", name: "Dumbbell Romanian Deadlift" }],
    note: "PENDING Ivo confirm: both Cori's, 1 use each, same movement",
  },
];

// Muscle lists for the rows the old quarantine emptied to [] (applied only
// while the row's normalized list is still empty, so later edits win).
const EMPTY_FILLS: Record<string, { name: string; muscles: string[] }> = {
  "12958714-9f9a-465c-8329-2af97ccd7b88": { name: "Cable Pull-Through", muscles: ["Glutes", "Hamstrings"] },
  "cc0c75bc-8dbd-4107-8d42-29e36a9f3214": { name: "DB Romanian Deadlift", muscles: ["Hamstrings", "Glutes", "Lower Back"] },
  "9d5ae139-83c4-4793-8df8-5f201a002910": { name: "Seated Leg Curl", muscles: ["Hamstrings"] },
  "aef095e3-ea73-46d5-b26b-13f5c30dc54f": { name: "SL B-Stance DB RDL", muscles: ["Hamstrings", "Glutes"] },
};

const APPLY = process.argv.includes("--apply");
const INCLUDE_PENDING = process.argv.includes("--include-pending");

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.filter((x) => typeof x === "string") : [v];
    } catch {
      return [v];
    }
  }
  return [];
}

function asObjArray(v: unknown): Record<string, unknown>[] | null {
  let parsed = v;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  return parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
}

const sameArr = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const cleanName = (s: string) => s.replace(/\s+/g, " ").trim();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  const backup: Record<string, unknown> = { generatedAt: new Date().toISOString() };
  const report: string[] = [];
  const log = (s: string) => {
    report.push(s);
    console.log(s);
  };

  try {
    const merges = [...MERGES, ...(INCLUDE_PENDING ? PENDING_MERGES : [])];
    const catalog = (await sql`select id, name, user_id, muscle_groups from exercises`) as Array<{
      id: string;
      name: string;
      user_id: string | null;
      muscle_groups: unknown;
    }>;
    const byId = new Map(catalog.map((c) => [c.id, c]));

    // Sanity: every configured id that is still present must carry the expected
    // name (already-applied runs have deleted the absorbed rows - that's fine).
    for (const m of merges) {
      const keep = byId.get(m.keepId);
      if (!keep) throw new Error(`survivor ${m.keepId} (${m.finalName}) not found`);
      if (keep.name !== m.keepName && keep.name !== m.finalName) {
        throw new Error(
          `survivor ${m.keepId} name is ${JSON.stringify(keep.name)}, expected ${JSON.stringify(m.keepName)} or ${JSON.stringify(m.finalName)}`,
        );
      }
      for (const a of m.absorb) {
        const row = byId.get(a.id);
        if (row && row.name !== a.name) {
          throw new Error(`absorb ${a.id} name is ${JSON.stringify(row.name)}, expected ${JSON.stringify(a.name)}`);
        }
      }
    }

    const activeMerges = merges
      .map((m) => ({ ...m, absorb: m.absorb.filter((a) => byId.has(a.id)) }))
      .filter((m) => m.absorb.length > 0 || byId.get(m.keepId)!.name !== m.finalName ||
        !sameArr(normalizeMuscleGroups(asArray(byId.get(m.keepId)!.muscle_groups)), m.finalMuscles));

    // ORIGINAL normalized name -> final surviving {id, name}, used for inline
    // jsonb name refs and the empty-exercise_id orphan heal. Built from the
    // FULL config (not just active) so a re-run still resolves old names.
    const nameToFinal = new Map<string, { id: string; name: string }>();
    for (const m of merges) {
      nameToFinal.set(normalizeExerciseName(m.keepName), { id: m.keepId, name: m.finalName });
      nameToFinal.set(normalizeExerciseName(m.finalName), { id: m.keepId, name: m.finalName });
      for (const a of m.absorb) {
        nameToFinal.set(normalizeExerciseName(a.name), { id: m.keepId, name: m.finalName });
      }
    }
    const absorbIds = new Set(activeMerges.flatMap((m) => m.absorb.map((a) => a.id)));
    const allConfiguredAbsorbIds = new Set(merges.flatMap((m) => m.absorb.map((a) => a.id)));

    log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}${INCLUDE_PENDING ? " (+pending)" : ""}`);
    log(`Catalog: ${catalog.length} exercises. Active merges: ${activeMerges.length}.`);
    if (!INCLUDE_PENDING && PENDING_MERGES.length) {
      for (const p of PENDING_MERGES) {
        log(`PENDING (not applied without --include-pending): "${p.absorb.map((a) => a.name).join('", "')}" -> "${p.finalName}" [${p.note}]`);
      }
    }

    // --- 1. Merge impact scan -------------------------------------------------
    const weRepoint: Array<{ id: string; from: string; to: string }> = [];
    const prRepoint: Array<{ id: string; from: string; to: string }> = [];
    const goalRepoint: Array<{ id: string; from: string; to: string; name: string }> = [];
    for (const m of activeMerges) {
      for (const a of m.absorb) {
        const we = await sql`select id from workout_exercises where exercise_id = ${a.id}`;
        we.forEach((r) => weRepoint.push({ id: r.id as string, from: a.id, to: m.keepId }));
        const pr = await sql`select id from pr_history where exercise_id = ${a.id}`;
        pr.forEach((r) => prRepoint.push({ id: r.id as string, from: a.id, to: m.keepId }));
        const g = await sql`select id from exercise_goals where exercise_id = ${a.id}`;
        g.forEach((r) =>
          goalRepoint.push({ id: r.id as string, from: a.id, to: m.keepId, name: m.finalName }),
        );
      }
    }

    // Inline jsonb rewrites. An entry matches a merge if its id is the absorbed
    // (or surviving) id, or its normalized name maps in nameToFinal.
    interface JsonbFix {
      table: string;
      id: string;
      col: string;
      next: unknown;
      touched: string[];
    }
    const jsonbFixes: JsonbFix[] = [];

    function rewriteEntries(entries: Record<string, unknown>[]): { changed: boolean; touched: string[] } {
      let changed = false;
      const touched: string[] = [];
      for (const e of entries) {
        const rawName = typeof e.name === "string" ? (e.name as string) : "";
        const target =
          (typeof e.id === "string" &&
            activeMerges.find((m) => m.absorb.some((a) => a.id === e.id) || m.keepId === e.id)) ||
          undefined;
        const byName = nameToFinal.get(normalizeExerciseName(rawName));
        const final = target
          ? { id: target.keepId, name: target.finalName }
          : byName;
        if (!final) continue;
        const wantId = typeof e.id === "string" ? final.id : undefined;
        if ((wantId !== undefined && e.id !== wantId) || (rawName && rawName !== final.name)) {
          touched.push(`${rawName || (e.id as string)} -> ${final.name}`);
          if (wantId !== undefined) e.id = wantId;
          if (rawName) e.name = final.name;
          changed = true;
        }
      }
      return { changed, touched };
    }

    async function scanJsonb(table: string, col: string, wrap?: string) {
      const rows = (await sql`select id, ${sql(col)} as val from ${sql(table)}`) as Array<{
        id: string;
        val: unknown;
      }>;
      for (const r of rows) {
        const container = wrap
          ? (r.val as Record<string, unknown> | null)
          : null;
        const arr = wrap
          ? asObjArray(container?.[wrap])
          : asObjArray(r.val);
        if (!arr) continue;
        const { changed, touched } = rewriteEntries(arr);
        if (changed) {
          const next = wrap ? { ...(container as object), [wrap]: arr } : arr;
          jsonbFixes.push({ table, id: r.id, col, next, touched });
        }
      }
    }
    await scanJsonb("workout_templates", "exercises");
    await scanJsonb("scheduled_workouts", "exercises");
    await scanJsonb("routine_entries", "exercises");
    await scanJsonb("active_workouts", "workout_data", "exercises");

    log(`\n--- Merges ---`);
    for (const m of activeMerges) {
      log(
        `KEEP ${m.keepId} "${byId.get(m.keepId)!.name}" -> "${m.finalName}" muscles=[${m.finalMuscles.join(", ")}]  (${m.note})`,
      );
      for (const a of m.absorb) log(`  absorb ${a.id} "${a.name}" (row deleted)`);
    }
    log(`history rows repointed: ${weRepoint.length}`);
    log(`pr_history rows repointed: ${prRepoint.length}`);
    log(`exercise_goals repointed: ${goalRepoint.length}`);
    for (const f of jsonbFixes) log(`inline ${f.table}#${f.id.slice(0, 8)}: ${f.touched.join("; ")}`);

    // --- 2. Muscle repair scan ------------------------------------------------
    const muscleFixes: Array<{ id: string; name: string; before: unknown; after: string[]; kind: string }> = [];
    for (const c of catalog) {
      if (absorbIds.has(c.id)) continue; // being deleted
      const merged = activeMerges.find((m) => m.keepId === c.id);
      if (merged) continue; // handled by the merge update
      const raw = asArray(c.muscle_groups);
      let after = normalizeMuscleGroups(raw);
      let kind = Array.isArray(c.muscle_groups) ? "normalize" : "decode+normalize";
      if (after.length === 0 && EMPTY_FILLS[c.id]) {
        if (EMPTY_FILLS[c.id].name !== c.name && normalizeExerciseName(EMPTY_FILLS[c.id].name) !== normalizeExerciseName(c.name)) {
          throw new Error(`EMPTY_FILLS name mismatch for ${c.id}: ${c.name}`);
        }
        after = EMPTY_FILLS[c.id].muscles;
        kind = "hand-fill (was quarantined empty)";
      }
      const isCleanArray = Array.isArray(c.muscle_groups) && sameArr(raw, after);
      // A non-array value gets rewritten even when it normalizes to empty, so
      // the column ends uniformly jsonb-array-typed.
      if (!isCleanArray && (after.length > 0 || !Array.isArray(c.muscle_groups))) {
        muscleFixes.push({ id: c.id, name: c.name, before: c.muscle_groups, after, kind });
      }
    }
    log(`\n--- Muscle repair (${muscleFixes.length} rows) ---`);
    for (const f of muscleFixes) {
      log(`  ${f.name}: ${JSON.stringify(f.before)} -> [${f.after.join(", ")}]  (${f.kind})`);
    }

    // --- 3. Name trims --------------------------------------------------------
    const nameTrims: Array<{ id: string; before: string; after: string }> = [];
    for (const c of catalog) {
      if (absorbIds.has(c.id)) continue;
      if (activeMerges.some((m) => m.keepId === c.id)) continue; // rename handled there
      const cleaned = cleanName(c.name);
      if (cleaned !== c.name) {
        const collision =
          catalog.filter((o) => !absorbIds.has(o.id) && o.id !== c.id &&
            cleanName(o.name).toLowerCase() === cleaned.toLowerCase()).length > 0;
        if (collision) {
          log(`SKIP trim (collision): "${c.name}"`);
          continue;
        }
        nameTrims.push({ id: c.id, before: c.name, after: cleaned });
      }
    }
    log(`\n--- Name trims (${nameTrims.length}) ---`);
    for (const t of nameTrims) log(`  ${JSON.stringify(t.before)} -> ${JSON.stringify(t.after)}`);

    // --- 4. Orphan heal (empty exercise_id history rows) ----------------------
    // Resolve each snapshot name through the original-name mapping first (so
    // merged/renamed rows land on the survivor), then exact normalized catalog
    // name, then the fuzzy matcher as a last resort.
    const orphanRows = (await sql`
      select we.id, we.name_snapshot from workout_exercises we where we.exercise_id = ''
    `) as Array<{ id: string; name_snapshot: string | null }>;
    const currentNameToId = new Map<string, string>();
    for (const c of catalog) {
      if (absorbIds.has(c.id) || allConfiguredAbsorbIds.has(c.id)) continue;
      const m = merges.find((mm) => mm.keepId === c.id);
      currentNameToId.set(normalizeExerciseName(m ? m.finalName : cleanName(c.name)), c.id);
      currentNameToId.set(normalizeExerciseName(c.name), c.id);
    }
    const matcherCatalog = catalog
      .filter((c) => !absorbIds.has(c.id))
      .map((c) => {
        const m = merges.find((mm) => mm.keepId === c.id);
        return { id: c.id, name: m ? m.finalName : c.name };
      });
    const orphanHeals: Array<{ id: string; snap: string; to: string; via: string }> = [];
    const orphanUnresolved: string[] = [];
    for (const o of orphanRows) {
      const snap = o.name_snapshot ?? "";
      const key = normalizeExerciseName(snap);
      const mapped = nameToFinal.get(key)?.id ?? currentNameToId.get(key);
      if (mapped) {
        orphanHeals.push({ id: o.id, snap, to: mapped, via: "name" });
        continue;
      }
      const fuzzy = matchExercise(snap, matcherCatalog);
      if (fuzzy) orphanHeals.push({ id: o.id, snap, to: fuzzy.id, via: `fuzzy ${fuzzy.score.toFixed(2)} -> ${fuzzy.name}` });
      else orphanUnresolved.push(snap);
    }
    log(`\n--- Orphan heal: ${orphanHeals.length} of ${orphanRows.length} empty-id history rows relink ---`);
    const healByName = new Map<string, number>();
    for (const h of orphanHeals) healByName.set(`${h.snap} [${h.via}]`, (healByName.get(`${h.snap} [${h.via}]`) ?? 0) + 1);
    for (const [k, n] of healByName) log(`  ${k} x${n}`);
    if (orphanUnresolved.length) log(`  UNRESOLVED (left as-is): ${orphanUnresolved.join(", ")}`);

    // --- 5. Snapshot heal -----------------------------------------------------
    const snapRows = (await sql`
      select we.id, we.exercise_id, we.muscle_groups_snapshot as snap
      from workout_exercises we
      where we.muscle_groups_snapshot is null
         or jsonb_typeof(we.muscle_groups_snapshot) <> 'array'
         or we.muscle_groups_snapshot = '[]'::jsonb
         or exists (
              select 1 from jsonb_array_elements_text(
                case when jsonb_typeof(we.muscle_groups_snapshot) = 'array'
                     then we.muscle_groups_snapshot else '[]'::jsonb end) t(v)
              where v like '%(%'
            )
    `) as Array<{ id: string; exercise_id: string; snap: unknown }>;
    // Final muscle list per surviving exercise id (post-merge, post-repair).
    const finalMusclesById = new Map<string, string[]>();
    for (const c of catalog) {
      if (absorbIds.has(c.id)) continue;
      finalMusclesById.set(c.id, normalizeMuscleGroups(asArray(c.muscle_groups)));
    }
    for (const m of activeMerges) {
      finalMusclesById.set(m.keepId, m.finalMuscles);
      for (const a of m.absorb) finalMusclesById.set(a.id, m.finalMuscles);
    }
    for (const f of muscleFixes) finalMusclesById.set(f.id, f.after);
    const snapHeals: Array<{ id: string; before: unknown; after: string[]; via: string }> = [];
    for (const r of snapRows) {
      const decoded = normalizeMuscleGroups(asArray(r.snap));
      if (decoded.length) {
        snapHeals.push({ id: r.id, before: r.snap, after: decoded, via: "normalize" });
        continue;
      }
      const fromCatalog = finalMusclesById.get(r.exercise_id) ?? [];
      if (fromCatalog.length) {
        snapHeals.push({ id: r.id, before: r.snap, after: fromCatalog, via: "from exercise" });
      }
    }
    log(`\n--- Snapshot heal (${snapHeals.length} of ${snapRows.length} flagged history rows) ---`);
    const snapSummary = new Map<string, number>();
    for (const s of snapHeals) {
      const k = `${JSON.stringify(s.before)} -> [${s.after.join(", ")}] (${s.via})`;
      snapSummary.set(k, (snapSummary.get(k) ?? 0) + 1);
    }
    for (const [k, n] of snapSummary) log(`  ${k} x${n}`);

    const totalChanges =
      weRepoint.length + prRepoint.length + goalRepoint.length + jsonbFixes.length +
      muscleFixes.length + nameTrims.length + orphanHeals.length + snapHeals.length +
      activeMerges.length;
    log(`\nTotal change units: ${totalChanges}`);

    if (!APPLY) {
      log(`\nDry-run only. Re-run with --apply to write.`);
      return;
    }
    if (totalChanges === 0) {
      log(`Nothing to do (already applied).`);
      return;
    }

    // --- Backup ---------------------------------------------------------------
    const dir = join(process.cwd(), "migration", "exercise-merge-backups");
    mkdirSync(dir, { recursive: true });
    backup.catalog = catalog;
    backup.weRepoint = weRepoint;
    backup.prRepoint = prRepoint;
    backup.goalRepoint = goalRepoint;
    backup.jsonbFixes = await Promise.all(
      jsonbFixes.map(async (f) => ({
        table: f.table,
        id: f.id,
        before: (await sql`select ${sql(f.col)} as v from ${sql(f.table)} where id = ${f.id}`)[0]?.v,
      })),
    );
    backup.muscleFixes = muscleFixes;
    backup.nameTrims = nameTrims;
    backup.orphanHeals = orphanHeals;
    backup.snapHealsBefore = snapHeals.map((s) => ({ id: s.id, before: s.before }));
    const backupPath = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    log(`\nBackup written: ${backupPath}`);

    // --- Apply ----------------------------------------------------------------
    await sql.begin(async (tx) => {
      for (const m of activeMerges) {
        const ids = m.absorb.map((a) => a.id);
        if (ids.length) {
          await tx`update workout_exercises set exercise_id = ${m.keepId} where exercise_id = any(${ids})`;
          await tx`update pr_history set exercise_id = ${m.keepId} where exercise_id = any(${ids})`;
          await tx`update exercise_goals set exercise_id = ${m.keepId}, exercise_name = ${m.finalName} where exercise_id = any(${ids})`;
        }
        await tx`update exercises set name = ${m.finalName}, muscle_groups = ${tx.json(m.finalMuscles)} where id = ${m.keepId}`;
        if (ids.length) await tx`delete from exercises where id = any(${ids})`;
      }
      for (const f of jsonbFixes) {
        await tx`update ${tx(f.table)} set ${tx(f.col)} = ${tx.json(f.next as never)} where id = ${f.id}`;
      }
      for (const f of muscleFixes) {
        await tx`update exercises set muscle_groups = ${tx.json(f.after)} where id = ${f.id}`;
      }
      for (const t of nameTrims) {
        await tx`update exercises set name = ${t.after} where id = ${t.id}`;
      }
      for (const h of orphanHeals) {
        await tx`update workout_exercises set exercise_id = ${h.to} where id = ${h.id}`;
      }
      for (const s of snapHeals) {
        await tx`update workout_exercises set muscle_groups_snapshot = ${tx.json(s.after)} where id = ${s.id}`;
      }
    });
    log(`Applied.`);

    // --- Self-verify ----------------------------------------------------------
    const deadIds = [...allConfiguredAbsorbIds];
    const stillWe = await sql`select count(*)::int as n from workout_exercises where exercise_id = any(${deadIds})`;
    const stillPr = await sql`select count(*)::int as n from pr_history where exercise_id = any(${deadIds})`;
    const stillEx = await sql`select count(*)::int as n from exercises where id = any(${deadIds})`;
    const badMg = await sql`select count(*)::int as n from exercises where jsonb_typeof(muscle_groups) <> 'array'`;
    const untrimmed = await sql`select count(*)::int as n from exercises where name <> trim(name) or name like '%  %'`;
    const orphansLeft = await sql`select count(*)::int as n from workout_exercises where exercise_id = ''`;
    const names = await sql`select name from exercises where id = any(${merges.map((m) => m.keepId)})`;
    log(`\n--- Verify ---`);
    log(`absorbed ids in workout_exercises: ${stillWe[0].n} (want 0)`);
    log(`absorbed ids in pr_history: ${stillPr[0].n} (want 0)`);
    log(`absorbed exercise rows remaining: ${stillEx[0].n} (want 0)`);
    log(`non-array muscle_groups: ${badMg[0].n} (want 0)`);
    log(`untrimmed names: ${untrimmed[0].n} (want 0)`);
    log(`empty-id history rows remaining: ${orphansLeft[0].n}`);
    log(`survivor names now: ${names.map((n) => JSON.stringify(n.name)).join(", ")}`);
    const ok =
      stillWe[0].n === 0 && stillPr[0].n === 0 && stillEx[0].n === 0 &&
      badMg[0].n === 0 && untrimmed[0].n === 0;
    log(ok ? "VERIFY OK" : "VERIFY FAILED - inspect above");
    if (!ok) process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
