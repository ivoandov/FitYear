/**
 * Anchors BOTH `routine_instances.start_date` and `end_date` at NOON UTC, to
 * match every `scheduled_workouts.date`.
 *
 * `routines/[id]/start` wrote start_date as the RAW client instant, and rows
 * predating the noon convention have un-anchored end dates too, so a single
 * instance could carry three different conventions across its two columns. The
 * integration payload reads both, and an un-anchored value reports the wrong
 * day from UTC+12 east.
 *
 * Recovering the intended day needs TWO rules, because two different things
 * wrote these rows:
 *   - EXACTLY 00:00:00 UTC is `new Date("YYYY-MM-DD")` parsing a bare date
 *     string, so the date part IS the authored day. Resolving it in a western
 *     zone would move it a day EARLIER - the 2026-01-19 row would become the
 *     18th, which is a corruption, not a fix.
 *   - Anything else is a real instant (local midnight at 07:00Z, or a raw
 *     `new Date()` at 22:29:47), so it resolves in the OWNER'S zone.
 * Rows with no stored zone are reported and assumed America/Los_Angeles, the
 * same call the scheduled_workouts pass made.
 *
 * Dry-run by default, `--apply` to write. One transaction, self-verifying,
 * idempotent. Builds the timestamp in SQL from the date key, because binding a
 * timestamp string through postgres.js applies THIS machine's zone.
 */
import postgres from "postgres";
import { localDateKeyInZone } from "@/lib/date";

const APPLY = process.argv.includes("--apply");
const FALLBACK_TZ = "America/Los_Angeles";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false });

  try {
    const rows = (await sql`
      select ri.id, ri.user_id,
             to_char(ri.start_date, 'YYYY-MM-DD HH24:MI:SS') as start_lit,
             to_char(ri.end_date,   'YYYY-MM-DD HH24:MI:SS') as end_lit,
             ri.status, us.time_zone
        from routine_instances ri
        left join user_settings us on us.user_id = ri.user_id
       order by ri.start_date`) as unknown as Array<{
      id: string; user_id: string | null; start_lit: string; end_lit: string;
      status: string | null; time_zone: string | null;
    }>;

    const planned: Array<{ id: string; col: "start_date" | "end_date"; from: string; key: string; how: string }> = [];
    for (const r of rows) {
      const tz = r.time_zone ?? FALLBACK_TZ;
      for (const [col, lit] of [["start_date", r.start_lit], ["end_date", r.end_lit]] as const) {
        const [datePart, timePart] = lit.split(" ");
        if (timePart === "12:00:00") continue;
        if (timePart === "00:00:00") {
          planned.push({ id: r.id, col, from: lit, key: datePart, how: "bare date string, kept as-is" });
        } else {
          planned.push({
            id: r.id,
            col,
            from: lit,
            key: localDateKeyInZone(new Date(`${datePart}T${timePart}Z`), tz),
            how: `instant resolved in ${tz}${r.time_zone ? "" : " (ASSUMED)"}`,
          });
        }
      }
    }

    console.log(`${rows.length} routine instances, ${planned.length} column values to re-anchor\n`);
    for (const p of planned) {
      console.log(`  ${p.col.padEnd(10)} ${p.from} -> ${p.key} 12:00:00  (${p.how})`);
    }
    if (!planned.length) { console.log("Nothing to do."); return; }
    if (!APPLY) { console.log("\nDRY RUN. Re-run with --apply to write."); return; }

    await sql.begin(async (tx) => {
      for (const p of planned) {
        // Two literal statements rather than an interpolated column name: the
        // column is a closed set, and this keeps the query non-dynamic.
        if (p.col === "start_date") {
          await tx`update routine_instances
                      set start_date = ${p.key}::date + interval '12 hours'
                    where id = ${p.id}`;
        } else {
          await tx`update routine_instances
                      set end_date = ${p.key}::date + interval '12 hours'
                    where id = ${p.id}`;
        }
      }
    });

    const [{ n: left }] = (await sql`
      select count(*)::int as n from routine_instances
       where to_char(start_date, 'HH24:MI:SS') <> '12:00:00'
          or to_char(end_date,   'HH24:MI:SS') <> '12:00:00'`) as unknown as Array<{ n: number }>;
    console.log(`\n--- Verify ---`);
    console.log(`instance dates not anchored at noon UTC: ${left} (want 0)`);
    if (left) throw new Error("VERIFY FAILED");
    console.log("VERIFY OK");
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
