/**
 * Move five hold exercises from "reps" to "time".
 *
 * These were logged as weight_reps with the SECONDS typed into the reps column,
 * because that is what the app offered at the time. Nothing reads exercise_type
 * when computing volume - every analytics query is `weight_lbs * reps` wherever
 * both are present - so a 60-second plate pinch at 25 lb has been counting as
 * 1,500 lb of Forearms volume, and Epley has been turning it into a fake 1RM.
 *
 * Changing only the catalog type would NOT have fixed this and would have made
 * it worse: history keeps its own exercise_type snapshot, so the old rows would
 * go on producing fake volume forever while every NEW set (written to `time`,
 * with `reps` null) silently vanished from the charts, which all filter on
 * `reps > 0`. The exercise's graph would simply stop on the day of the switch.
 *
 * So this migrates the DATA and the SNAPSHOTS and the catalog type together.
 *
 * Ivo confirmed the list by hand (2026-09-09): the crunches are genuinely reps
 * despite looking like durations, and are deliberately NOT included.
 *
 * Idempotent: only touches rows that still have reps set and no time, so a
 * second run reports 0 and changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/apply-hold-durations.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/apply-hold-durations.ts --apply
 */
import postgres from "postgres";

/** Matched on exact catalog name. Ivo-confirmed; do not widen without asking. */
const HOLD_NAMES = [
  "Plate Pinch",
  "Neutral Grip Active Scapular Hangs",
  "Neutral Grip Dead Hang",
  "Dumbbell Isometric Wrist Flexor Holds",
  "Flat Bench Wrist Holds",
];

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const targets = await sql`
      select id, name, exercise_type from exercises where name = any(${HOLD_NAMES})`;
    console.log(`Catalog matches: ${targets.length} of ${HOLD_NAMES.length}`);
    for (const t of targets) console.log(`  ${t.name}  (${t.exercise_type})  ${t.id}`);
    const missing = HOLD_NAMES.filter((n) => !targets.some((t) => t.name === n));
    if (missing.length) console.log(`  NOT FOUND: ${missing.join(", ")}`);
    if (!targets.length) {
      console.log("Nothing to do.");
      return;
    }
    const ids = targets.map((t) => t.id as string);

    // Every set that still carries its duration in the wrong column.
    const rows = await sql`
      select ws.id, e.name, ws.reps, ws.time, ws.weight_lbs, ws.completed
      from workout_sets ws
      join workout_exercises we on we.id = ws.workout_exercise_id
      join exercises e on e.id = we.exercise_id
      where e.id = any(${ids})
        and ws.reps is not null and ws.reps > 0
        and (ws.time is null or ws.time = 0)
      order by e.name, ws.id`;
    console.log(`\nSets to move (reps -> time): ${rows.length}`);
    const byName = new Map<string, number[]>();
    for (const r of rows) {
      if (!byName.has(r.name)) byName.set(r.name, []);
      byName.get(r.name)!.push(r.reps);
    }
    for (const [name, reps] of byName) {
      const phantom = rows
        .filter((r) => r.name === name)
        .reduce((n, r) => n + (r.weight_lbs ?? 0) * (r.reps ?? 0), 0);
      console.log(`  ${name}: ${reps.length} sets [${reps.join(", ")}]s, removing ${Math.round(phantom).toLocaleString()} lb of phantom volume`);
    }

    const snaps = await sql`
      select count(*)::int as n from workout_exercises we
      where we.exercise_id = any(${ids}) and coalesce(we.exercise_type, '') <> 'weight_time'`;
    console.log(`Snapshots to retype: ${snaps[0].n}`);
    const cat = targets.filter((t) => t.exercise_type !== "weight_time").length;
    console.log(`Catalog rows to retype: ${cat}`);

    if (!apply) {
      console.log("\nDRY RUN. Re-run with --apply to write.");
      return;
    }

    await sql.begin(async (tx) => {
      // The seconds move column; nothing is invented and nothing is discarded.
      const moved = await tx`
        update workout_sets ws
        set time = ws.reps, reps = null
        from workout_exercises we
        where we.id = ws.workout_exercise_id
          and we.exercise_id = any(${ids})
          and ws.reps is not null and ws.reps > 0
          and (ws.time is null or ws.time = 0)
        returning ws.id`;
      // The per-workout snapshot is what every reader trusts for shape, so it
      // has to agree with the data or PR detection still scores these as lifts.
      const retyped = await tx`
        update workout_exercises set exercise_type = 'weight_time'
        where exercise_id = any(${ids}) and coalesce(exercise_type, '') <> 'weight_time'
        returning id`;
      const recat = await tx`
        update exercises set exercise_type = 'weight_time'
        where id = any(${ids}) and exercise_type <> 'weight_time'
        returning id`;
      console.log(`\nAPPLIED: ${moved.length} sets, ${retyped.length} snapshots, ${recat.length} catalog rows`);
    });

    const left = await sql`
      select count(*)::int as n from workout_sets ws
      join workout_exercises we on we.id = ws.workout_exercise_id
      where we.exercise_id = any(${ids}) and ws.reps is not null and ws.reps > 0`;
    const withTime = await sql`
      select count(*)::int as n from workout_sets ws
      join workout_exercises we on we.id = ws.workout_exercise_id
      where we.exercise_id = any(${ids}) and ws.time > 0`;
    console.log(`VERIFY: ${left[0].n} sets still carry reps (want 0), ${withTime[0].n} now carry time`);
    if (left[0].n !== 0) throw new Error("rows still carry reps - investigate before trusting this");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
