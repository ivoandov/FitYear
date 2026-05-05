/**
 * Phase 2 step 6: Per-user verification — Neon vs Supabase row counts MUST match
 * exactly for every user across every table. Plus a content hash on
 * completed_workouts to catch silent corruption.
 *
 * Exits 1 if any mismatch.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import postgres from "postgres";
import { neon } from "@neondatabase/serverless";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const supaUrl = process.env.DATABASE_URL!;
const neonUrl = process.env.LEGACY_NEON_DATABASE_URL!;

const supa = postgres(supaUrl, { prepare: false, ssl: "require", max: 1 });
const neonSql = neon(neonUrl);

interface MapEntry {
  email: string;
  oldUserId: string;
  newUuid: string;
}

const TABLES_WITH_USER_ID = [
  "exercises",
  "workout_templates",
  "scheduled_workouts",
  "completed_workouts",
  "user_settings",
  "routines",
  "routine_instances",
  "exercise_goals",
  "google_calendar_tokens",
];

function hashRow(obj: Record<string, unknown>): string {
  const stable = Object.keys(obj)
    .sort()
    .map((k) => `${k}=${JSON.stringify(obj[k])}`)
    .join("|");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

async function main() {
  const snapshotsRoot = join(process.cwd(), "migration", "snapshots");
  const dates = readdirSync(snapshotsRoot).sort().reverse();
  const map: MapEntry[] = JSON.parse(
    readFileSync(join(snapshotsRoot, dates[0], "_user_map.json"), "utf8"),
  );

  console.log(`\n=== Per-user row count verification ===\n`);
  console.log(
    `User`.padEnd(34) +
      TABLES_WITH_USER_ID.map((t) => t.slice(0, 14).padStart(14)).join(""),
  );

  let mismatches = 0;

  for (const u of map) {
    const counts: Record<string, { neon: number; supa: number }> = {};
    for (const table of TABLES_WITH_USER_ID) {
      const neonRes = await neonSql.query(
        `SELECT COUNT(*)::int AS c FROM ${table} WHERE user_id = $1`,
        [u.oldUserId],
      );
      const supaRes = await supa.unsafe(
        `SELECT COUNT(*)::int AS c FROM ${table} WHERE user_id = $1`,
        [u.newUuid],
      );
      counts[table] = { neon: neonRes[0].c, supa: (supaRes as unknown as Array<{ c: number }>)[0].c };
    }

    const row = u.email.padEnd(34) +
      TABLES_WITH_USER_ID.map((t) => {
        const { neon: n, supa: s } = counts[t];
        const ok = n === s;
        if (!ok) mismatches++;
        const cell = ok ? `${n}`.padStart(14) : `${n}≠${s}`.padStart(14);
        return ok ? cell : `\x1b[31m${cell}\x1b[0m`;
      }).join("");
    console.log(row);
  }

  console.log(`\n=== Public exercises (user_id IS NULL) ===\n`);
  const neonPub = await neonSql.query(
    `SELECT COUNT(*)::int AS c FROM exercises WHERE user_id IS NULL`,
  );
  const supaPub = await supa`SELECT COUNT(*)::int AS c FROM exercises WHERE user_id IS NULL`;
  const npc = neonPub[0].c, spc = supaPub[0].c;
  console.log(
    `  exercises (public): neon=${npc}  supa=${spc}  ${npc === spc ? "✓" : "✗"}`,
  );
  if (npc !== spc) mismatches++;

  console.log(`\n=== completed_workouts content hash ===\n`);
  const neonCw = await neonSql.query(
    `SELECT id, name, exercises::text AS exercises FROM completed_workouts ORDER BY id`,
  );
  const supaCw = await supa`SELECT id, name, exercises::text AS exercises FROM completed_workouts ORDER BY id`;
  const neonHashes = neonCw.map((r: Record<string, unknown>) => hashRow(r)).sort().join();
  const supaHashes = supaCw.map((r: Record<string, unknown>) => hashRow(r)).sort().join();
  const cwOk = createHash("sha256").update(neonHashes).digest("hex") === createHash("sha256").update(supaHashes).digest("hex");
  console.log(`  ${cwOk ? "✓ identical" : "✗ MISMATCH"} (${neonCw.length} rows on each side)`);
  if (!cwOk) {
    mismatches++;
    // Show first diff
    for (let i = 0; i < neonCw.length; i++) {
      if (hashRow(neonCw[i]) !== hashRow(supaCw[i] as Record<string, unknown>)) {
        console.log(`  first diff at row ${i}:`);
        console.log(`    neon:`, JSON.stringify(neonCw[i]).slice(0, 200));
        console.log(`    supa:`, JSON.stringify(supaCw[i]).slice(0, 200));
        break;
      }
    }
  }

  console.log(
    `\n${mismatches === 0 ? "✓ ALL CHECKS PASSED — zero data loss confirmed" : `✗ ${mismatches} MISMATCHES — investigate before proceeding`}\n`,
  );

  await supa.end();
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await supa.end();
  process.exit(1);
});
