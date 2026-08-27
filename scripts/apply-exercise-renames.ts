/**
 * One-shot backfill: rename the existing catalog to the canonical convention.
 *
 * The RULES live in src/lib/exercise-naming.ts and already run on every write
 * (manual add, edit, plan import, FitBot), so new rows are born canonical.
 * This brings the rows that predate that.
 *
 * House migration pattern: dry-run by default, `--apply` to write, gitignored
 * backup, one transaction, self-verifying, idempotent (a second run reports 0).
 *
 * WHAT IT REWRITES, and why by ID rather than by name:
 *   - exercises.name
 *   - inline jsonb `exercises[]` in routine_entries, scheduled_workouts,
 *     workout_templates and active_workouts, matched on the exercise ID. Name
 *     matching would rewrite a DIFFERENT exercise that happens to share a
 *     string, and these columns have no foreign keys to protect them.
 *   - workout_exercises.name_snapshot, scoped to that exercise_id.
 *
 * The snapshot rewrite is a deliberate reversal of the usual rule, on Ivo's
 * explicit call (2026-08-27). Snapshots normally record the name AT THE TIME
 * and are left alone - that is why "Calf Raises - Standing Machine " kept its
 * trailing space through the calf retag. He asked for consistency instead, so
 * History shows one spelling. The cost is that the record of what a movement
 * used to be called is lost; the backup file is the only way back.
 *
 * COLLISIONS ARE REFUSED. If two rows would end up sharing a name the script
 * renames NEITHER and reports them, because a rename that silently merges two
 * exercises is exactly the corruption this whole effort exists to prevent.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { canonicalExerciseName } from "@/lib/exercise-naming";

const APPLY = process.argv.includes("--apply");
const BACKUP_DIR = path.join(process.cwd(), "migration", "exercise-rename-backups");

interface Rename {
  id: string;
  from: string;
  to: string;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false });

  try {
    const rows = (await sql`select id, name from exercises order by name`) as unknown as Array<{
      id: string;
      name: string;
    }>;

    const proposed = rows.map((r) => ({ id: r.id, from: r.name, to: canonicalExerciseName(r.name) }));

    // Collision check across every FINAL name, including rows that are not
    // changing - a rename must never land on a name that already exists.
    const finalByName = new Map<string, Rename[]>();
    for (const p of proposed) {
      const key = p.to.toLowerCase();
      if (!finalByName.has(key)) finalByName.set(key, []);
      finalByName.get(key)!.push(p);
    }
    const colliding = new Set<string>();
    for (const [, group] of finalByName) {
      if (group.length > 1) for (const g of group) colliding.add(g.id);
    }

    const renames = proposed.filter((p) => p.to && p.to !== p.from && !colliding.has(p.id));
    const blocked = proposed.filter((p) => p.to !== p.from && colliding.has(p.id));

    console.log(`${rows.length} exercises`);
    console.log(`  ${proposed.filter((p) => p.to === p.from).length} already canonical`);
    console.log(`  ${renames.length} to rename`);
    console.log(`  ${blocked.length} BLOCKED by a collision (renaming neither)\n`);

    for (const r of renames) {
      console.log(`  ${JSON.stringify(r.from).padEnd(50)} -> ${JSON.stringify(r.to)}`);
    }
    if (blocked.length) {
      console.log(`\n  --- BLOCKED ---`);
      for (const b of blocked) {
        const others = finalByName
          .get(b.to.toLowerCase())!
          .filter((o) => o.id !== b.id)
          .map((o) => JSON.stringify(o.from));
        console.log(`  ${JSON.stringify(b.from)} -> ${JSON.stringify(b.to)} collides with ${others.join(", ")}`);
      }
    }

    if (!renames.length) {
      console.log("\nNothing to do.");
      return;
    }
    if (!APPLY) {
      console.log("\nDRY RUN. Re-run with --apply to write.");
      return;
    }

    // Back up every row this will touch, before touching any of it.
    const ids = renames.map((r) => r.id);
    const backup = {
      at: new Date().toISOString(),
      renames,
      exercises: await sql`select id, name from exercises where id = any(${ids})`,
      snapshots: await sql`
        select id, exercise_id, name_snapshot from workout_exercises where exercise_id = any(${ids})`,
      routineEntries: await sql`select id, exercises from routine_entries`,
      scheduledWorkouts: await sql`select id, exercises from scheduled_workouts`,
      workoutTemplates: await sql`select id, exercises from workout_templates`,
      activeWorkouts: await sql`select id, workout_data from active_workouts`,
    };
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupPath = path.join(BACKUP_DIR, `${backup.at.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`\nBackup written: ${backupPath}`);

    const byId = new Map(renames.map((r) => [r.id, r.to]));

    /** Rewrite the `name` of any inline entry whose `id` was renamed. */
    const rewriteInline = (value: unknown): { changed: boolean; next: unknown } => {
      if (!Array.isArray(value)) return { changed: false, next: value };
      let changed = false;
      const next = value.map((raw) => {
        if (!raw || typeof raw !== "object") return raw;
        const ex = raw as Record<string, unknown>;
        const to = typeof ex.id === "string" ? byId.get(ex.id) : undefined;
        if (to && ex.name !== to) {
          changed = true;
          return { ...ex, name: to };
        }
        return raw;
      });
      return { changed, next };
    };

    let inlineUpdates = 0;
    let snapshotUpdates = 0;

    await sql.begin(async (tx) => {
      for (const r of renames) {
        await tx`update exercises set name = ${r.to} where id = ${r.id}`;
        // Scoped to this exercise_id, so a different movement that once shared
        // the string is never touched.
        const res = await tx`
          update workout_exercises set name_snapshot = ${r.to} where exercise_id = ${r.id}`;
        snapshotUpdates += res.count ?? 0;
      }

      for (const table of ["routine_entries", "scheduled_workouts", "workout_templates"] as const) {
        const list = await tx.unsafe(`select id, exercises from ${table}`);
        for (const row of list as unknown as Array<{ id: string; exercises: unknown }>) {
          const { changed, next } = rewriteInline(row.exercises);
          if (!changed) continue;
          await tx.unsafe(`update ${table} set exercises = $1 where id = $2`, [
            JSON.stringify(next),
            row.id,
          ]);
          inlineUpdates++;
        }
      }

      // active_workouts nests its array inside workout_data.
      const actives = await tx`select id, workout_data from active_workouts`;
      for (const row of actives as unknown as Array<{ id: string; workout_data: Record<string, unknown> }>) {
        const wd = row.workout_data ?? {};
        const { changed, next } = rewriteInline(wd.exercises);
        if (!changed) continue;
        const nextData = { ...wd, exercises: next } as Record<string, unknown>;
        await tx.unsafe(`update active_workouts set workout_data = $1 where id = $2`, [
          JSON.stringify(nextData),
          row.id,
        ]);
        inlineUpdates++;
      }
    });

    console.log(`Applied. inline rows rewritten: ${inlineUpdates}, name snapshots rewritten: ${snapshotUpdates}`);

    // --- Verify ---
    const after = (await sql`select id, name from exercises`) as unknown as Array<{
      id: string;
      name: string;
    }>;
    const stillStale = after.filter((a) => byId.has(a.id) && a.name !== byId.get(a.id));
    const dupes = await sql`
      select lower(name) as n, count(*)::int c from exercises group by lower(name) having count(*) > 1`;
    const overLong = after.filter((a) => a.name.length > 60);

    console.log(`\n--- Verify ---`);
    console.log(`rows not renamed as planned: ${stillStale.length} (want 0)`);
    console.log(`duplicate names in the catalog: ${dupes.length} (want 0)`);
    console.log(`names over the 60-char cap: ${overLong.length} (want 0)`);
    if (stillStale.length || dupes.length || overLong.length) {
      throw new Error("VERIFY FAILED - restore from the backup above");
    }
    console.log("VERIFY OK");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
