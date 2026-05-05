/**
 * Phase 2 step 1: Snapshot the Neon production DB to local JSON files.
 *
 * Rollback artifact. Read-only on Neon. Run with:
 *   tsx migration/scripts/01-snapshot-neon.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const url = process.env.LEGACY_NEON_DATABASE_URL;
if (!url) throw new Error("LEGACY_NEON_DATABASE_URL not set in .env.local");

async function main() {
  const sql = neon(url);
  const outDir = join(process.cwd(), "migration", "snapshots", new Date().toISOString().split("T")[0]);
  mkdirSync(outDir, { recursive: true });

  const TABLES = [
    "users",
    "exercises",
    "workout_templates",
    "scheduled_workouts",
    "completed_workouts",
    "active_workouts",
    "user_settings",
    "routines",
    "routine_entries",
    "routine_instances",
    "exercise_goals",
    "google_calendar_tokens",
  ];

  console.log(`Snapshotting Neon DB to ${outDir}\n`);

  const summary: Record<string, number> = {};
  for (const table of TABLES) {
    const rows = await sql.query(`SELECT * FROM ${table}`);
    summary[table] = rows.length;
    writeFileSync(
      join(outDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      "utf8",
    );
    console.log(`  ${table.padEnd(28)} ${String(rows.length).padStart(5)} rows`);
  }

  writeFileSync(
    join(outDir, "_summary.json"),
    JSON.stringify(
      {
        snapshotAt: new Date().toISOString(),
        sourceDb: url.replace(/:[^:@]+@/, ":REDACTED@"),
        rowCounts: summary,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\n✓ Snapshot complete. ${Object.values(summary).reduce((a, b) => a + b, 0)} total rows.`);
  console.log(`  Saved to: ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
