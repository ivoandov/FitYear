/**
 * Backfill completed_workouts.routine_day_index for sessions saved before the
 * completion route started writing it.
 *
 * The column has existed since the routine work landed and NOTHING ever wrote
 * it, so no finished session knows which routine day it was. The scheduled row
 * it came from is gone by now, so the only evidence left is the workout NAME.
 *
 * **The name is matched EXACTLY against routine_entries.workout_name, and the
 * "Day N" inside it is never parsed.** That number is the plan's own label and
 * it does not agree with dayIndex: in the one program in prod, the session
 * called "Day 4: Muscle-Up Skill..." sits at dayIndex 5, because dayIndex is a
 * position in the ROTATION and the gaps are the rest days. Parsing would have
 * mis-attributed it by one day, silently, forever.
 *
 * A name that matches zero entries, or more than one, is left null and
 * reported: a wrong day is worse than a missing one, since every adherence
 * reader would trust it.
 *
 * Idempotent - it only ever fills nulls, so a re-run reporting 0 updated is the
 * healthy state.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-completed-day-index.ts
 *   npx tsx --env-file=.env.local scripts/backfill-completed-day-index.ts --apply
 */
import postgres from "postgres";

type Candidate = {
  id: string;
  name: string;
  routine_instance_id: string;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    const candidates = (await sql`
      select id, name, routine_instance_id
      from completed_workouts
      where routine_instance_id is not null
        and routine_day_index is null`) as unknown as Candidate[];

    console.log(`${candidates.length} completed workouts linked to a routine with no day index`);

    let matched = 0;
    let ambiguous = 0;
    let unmatched = 0;

    for (const row of candidates) {
      const entries = await sql`
        select re.day_index
        from routine_entries re
        join routines r on r.id = re.routine_id
        join routine_instances ri on ri.routine_id = r.id
        where ri.id = ${row.routine_instance_id}
          and re.workout_name = ${row.name}`;

      if (entries.length === 0) {
        unmatched++;
        console.log(`  SKIP (no entry named "${row.name}")`);
        continue;
      }
      if (entries.length > 1) {
        ambiguous++;
        console.log(`  SKIP (${entries.length} entries share the name "${row.name}")`);
        continue;
      }

      const dayIndex = entries[0].day_index as number;
      console.log(`  ${apply ? "SET" : "WOULD SET"} day_index=${dayIndex} for "${row.name}"`);
      if (apply) {
        await sql`
          update completed_workouts
          set routine_day_index = ${dayIndex}
          where id = ${row.id} and routine_day_index is null`;
      }
      matched++;
    }

    console.log(
      `\n${apply ? "updated" : "would update"}: ${matched}, ambiguous: ${ambiguous}, unmatched: ${unmatched}`,
    );

    if (apply) {
      const [after] = await sql`
        select count(*)::int as total,
               count(routine_day_index)::int as with_day
        from completed_workouts
        where routine_instance_id is not null`;
      console.log("VERIFY linked completed workouts:", after);
    } else {
      console.log("\nDry run. Re-run with --apply to write.");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
