/**
 * Re-anchors existing scheduled workouts to NOON UTC.
 *
 * A scheduled workout is a DAY, but `routines/[id]/start` stored it as local
 * midnight - 07:00Z for Los Angeles. Every zone WEST of the creating one then
 * reads that instant as the previous day, which is how Day 1 of Ivo's program
 * resolved to the 26th in Honolulu while looking correct everywhere east.
 *
 * Noon UTC is the same calendar day from UTC-12 through UTC+11, and is already
 * the convention the manual scheduling route uses. The write path now produces
 * it; this brings the rows that predate that.
 *
 * The intended day is recovered by resolving each stored instant in the OWNER'S
 * timezone, since that is the zone it was created in. Where no zone is stored
 * the row is reported and SKIPPED rather than guessed - moving a workout to the
 * wrong day is worse than leaving it on a fragile anchor.
 *
 * Dry-run by default, `--apply` to write. Idempotent: a row already at 12:00:00
 * UTC on the right day is left alone.
 */
import postgres from "postgres";
import { localDateKeyInZone, scheduledDateFromKey } from "@/lib/date";

const APPLY = process.argv.includes("--apply");
const FALLBACK_TZ = "America/Los_Angeles";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false });

  try {
    const rows = (await sql`
      select sw.id, sw.name, sw.user_id, sw.date,
             to_char(sw.date, 'YYYY-MM-DD HH24:MI:SS') as literal,
             us.time_zone
        from scheduled_workouts sw
        left join user_settings us on us.user_id = sw.user_id
       order by sw.date`) as unknown as Array<{
      id: string;
      name: string;
      user_id: string | null;
      date: Date;
      literal: string;
      time_zone: string | null;
    }>;

    const planned: Array<{ id: string; name: string; from: string; to: string; key: string; tz: string }> = [];
    const skipped: Array<{ name: string; why: string }> = [];

    for (const r of rows) {
      const [datePart, timePart] = r.literal.split(" ");
      if (timePart === "12:00:00") continue; // already anchored

      const tz = r.time_zone ?? FALLBACK_TZ;
      if (!r.time_zone) {
        // Recorded rather than silent: the fallback is a guess about where the
        // row was created, and a wrong guess moves a workout a day.
        skipped.push({ name: r.name, why: `no stored zone, assuming ${FALLBACK_TZ}` });
      }

      // The stored instant is local midnight in the creating zone, so resolving
      // it there recovers the day that was actually intended.
      const intendedKey = localDateKeyInZone(new Date(`${datePart}T${timePart}Z`), tz);
      const next = scheduledDateFromKey(intendedKey);
      planned.push({
        id: r.id,
        name: r.name,
        from: r.literal,
        to: `${intendedKey} 12:00:00`,
        // The DAY only. The timestamp is built server-side from this, because
        // binding a timestamp STRING through the driver applies the client
        // machine's local zone: sending "12:00:00" from a Mac on PDT stored
        // 19:00:00, which is a different calendar day for UTC+5 and east.
        key: intendedKey,
        tz,
      });
    }

    console.log(`${rows.length} scheduled workouts, ${planned.length} to re-anchor\n`);
    for (const p of planned) {
      console.log(`  ${p.name.slice(0, 40).padEnd(40)} ${p.from} -> ${p.to}  (${p.tz})`);
    }
    for (const s of skipped) console.log(`  NOTE ${s.name.slice(0, 40)}: ${s.why}`);

    if (!planned.length) {
      console.log("\nNothing to do.");
      return;
    }
    if (!APPLY) {
      console.log("\nDRY RUN. Re-run with --apply to write.");
      return;
    }

    await sql.begin(async (tx) => {
      for (const p of planned) {
        // Built entirely in SQL from the date key, so no client zone is
        // involved anywhere in the conversion.
        await tx`
          update scheduled_workouts
             set date = ${p.key}::date + interval '12 hours'
           where id = ${p.id}`;
      }
    });

    const [{ n: left }] = (await sql`
      select count(*)::int as n from scheduled_workouts
       where to_char(date, 'HH24:MI:SS') <> '12:00:00'`) as unknown as Array<{ n: number }>;
    console.log(`\n--- Verify ---`);
    console.log(`rows not anchored at noon UTC: ${left} (want 0)`);
    if (left) throw new Error("VERIFY FAILED");
    console.log("VERIFY OK");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
