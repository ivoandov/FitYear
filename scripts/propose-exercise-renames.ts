/**
 * REPORT ONLY - proposes a canonical name for every catalog exercise. Writes
 * nothing, ever. The approved output feeds a separate rename migration.
 *
 * The RULES now live in src/lib/exercise-naming.ts, which every write path uses
 * (manual add, edit, plan import, FitBot). This script exists only to show what
 * applying them to the EXISTING catalog would do, and to prove no two rows
 * would collide. One definition, so the backfill and the ongoing writes can
 * never drift apart.
 *
 *   npx tsx --env-file=.env.local scripts/propose-exercise-renames.ts
 *   npx tsx --env-file=.env.local scripts/propose-exercise-renames.ts --group=Chest
 */
import postgres from "postgres";
import { coarseGroupsOf } from "@/lib/muscle-groups";
import { canonicalExerciseName } from "@/lib/exercise-naming";

export interface Proposal {
  id: string;
  current: string;
  proposed: string;
  history: number;
  groups: string[];
  /** Populated when the proposal is unsafe to apply. */
  problem?: string;
}

function proposeName(original: string): { proposed: string; problem?: string } {
  const proposed = canonicalExerciseName(original);
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
