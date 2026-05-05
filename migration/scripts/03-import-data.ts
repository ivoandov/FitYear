/**
 * Phase 2 step 4-5: Transform + import Neon data into Supabase.
 *
 * For every row in every table:
 *   - Replace user_id (varchar) with the corresponding new Supabase UUID
 *     (using _user_map.json from step 02)
 *   - Convert ISO timestamp strings → Date objects so Postgres reinterprets them
 *   - Pass jsonb columns through as-is (postgres-js handles object → jsonb)
 *
 * Insert order respects FKs:
 *   profiles → exercises → workout_templates → routines → routine_entries
 *   → routine_instances → scheduled_workouts → completed_workouts
 *   → active_workouts → user_settings → exercise_goals → google_calendar_tokens
 *
 * Skipped tables (replaced or unused):
 *   users, sessions, conversations, messages, _system.replit_database_migrations_v1
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL not set");

const sql = postgres(DATABASE_URL, {
  prepare: false,
  ssl: "require",
  max: 1,
});

interface MapEntry {
  email: string;
  oldUserId: string;
  newUuid: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isoToDate<T extends Record<string, unknown>>(
  row: T,
  cols: (keyof T)[],
): T {
  for (const c of cols) {
    if (row[c] && typeof row[c] === "string") {
      (row as Record<string, unknown>)[c as string] = new Date(
        row[c] as string,
      );
    }
  }
  return row;
}

async function main() {
  const snapshotsRoot = join(process.cwd(), "migration", "snapshots");
  const dates = readdirSync(snapshotsRoot).sort().reverse();
  const snapshotDir = join(snapshotsRoot, dates[0]);
  console.log(`Using snapshot: ${snapshotDir}\n`);

  const userMap: MapEntry[] = loadJson(join(snapshotDir, "_user_map.json"));
  const oldToNew = new Map<string, string>();
  for (const m of userMap) oldToNew.set(m.oldUserId, m.newUuid);

  console.log(`User map loaded: ${oldToNew.size} entries\n`);

  const remap = (oldId: string | null | undefined): string | null => {
    if (!oldId) return null;
    const newId = oldToNew.get(oldId);
    if (!newId) {
      throw new Error(`Old user_id ${oldId} not found in map`);
    }
    return newId;
  };

  // 1. profiles — synthesize from user_map
  console.log("→ profiles");
  for (const m of userMap) {
    await sql`
      INSERT INTO profiles (id, email, first_name, last_name, profile_image_url)
      VALUES (${m.newUuid}::uuid, ${m.email}, ${m.firstName}, ${m.lastName}, ${m.profileImageUrl})
      ON CONFLICT (id) DO NOTHING
    `;
  }
  const pCount = await sql`SELECT COUNT(*)::int AS c FROM profiles`;
  console.log(`  ✓ ${pCount[0].c} profiles\n`);

  // 2. exercises — user_id can be null for public exercises
  console.log("→ exercises");
  const exercises = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "exercises.json"),
  );
  for (const ex of exercises) {
    await sql`
      INSERT INTO exercises (id, user_id, is_public, name, muscle_groups, description, image_url, exercise_type, is_assisted)
      VALUES (
        ${ex.id as string},
        ${ex.user_id ? remap(ex.user_id as string) : null}::uuid,
        ${ex.is_public as boolean},
        ${ex.name as string},
        ${sql.json(ex.muscle_groups as unknown[])},
        ${ex.description as string},
        ${(ex.image_url as string) ?? null},
        ${ex.exercise_type as string},
        ${ex.is_assisted as boolean}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  const exCount = await sql`SELECT COUNT(*)::int AS c FROM exercises`;
  console.log(`  ✓ ${exCount[0].c} exercises\n`);

  // 3. workout_templates
  console.log("→ workout_templates");
  const templates = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "workout_templates.json"),
  );
  for (const t of templates) {
    await sql`
      INSERT INTO workout_templates (id, user_id, name, exercises)
      VALUES (
        ${t.id as string},
        ${t.user_id ? remap(t.user_id as string) : null}::uuid,
        ${t.name as string},
        ${sql.json(t.exercises as unknown)}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${templates.length} workout_templates\n`);

  // 4. routines
  console.log("→ routines");
  const routines = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "routines.json"),
  );
  for (const r of routines) {
    isoToDate(r, ["created_at"]);
    await sql`
      INSERT INTO routines (id, user_id, name, description, default_duration_days, is_public, created_at)
      VALUES (
        ${r.id as string},
        ${remap(r.user_id as string)}::uuid,
        ${r.name as string},
        ${(r.description as string) ?? null},
        ${r.default_duration_days as number},
        ${r.is_public as boolean},
        ${r.created_at as Date}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${routines.length} routines\n`);

  // 5. routine_entries
  console.log("→ routine_entries");
  const routineEntries = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "routine_entries.json"),
  );
  for (const re of routineEntries) {
    await sql`
      INSERT INTO routine_entries (id, routine_id, day_index, workout_template_id, workout_name, exercises)
      VALUES (
        ${re.id as string},
        ${re.routine_id as string},
        ${re.day_index as number},
        ${(re.workout_template_id as string) ?? null},
        ${(re.workout_name as string) ?? null},
        ${re.exercises ? sql.json(re.exercises as unknown) : null}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${routineEntries.length} routine_entries\n`);

  // 6. routine_instances
  console.log("→ routine_instances");
  const routineInstances = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "routine_instances.json"),
  );
  for (const ri of routineInstances) {
    isoToDate(ri, ["start_date", "end_date", "created_at", "completed_at"]);
    await sql`
      INSERT INTO routine_instances (
        id, routine_id, user_id, routine_name, start_date, end_date,
        duration_days, total_workouts, completed_workouts, skipped_workouts,
        status, created_at, completed_at
      )
      VALUES (
        ${ri.id as string},
        ${ri.routine_id as string},
        ${remap(ri.user_id as string)}::uuid,
        ${ri.routine_name as string},
        ${ri.start_date as Date},
        ${ri.end_date as Date},
        ${ri.duration_days as number},
        ${ri.total_workouts as number},
        ${ri.completed_workouts as number},
        ${ri.skipped_workouts as number},
        ${ri.status as string},
        ${ri.created_at as Date},
        ${(ri.completed_at as Date) ?? null}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${routineInstances.length} routine_instances\n`);

  // 7. scheduled_workouts
  console.log("→ scheduled_workouts");
  const scheduled = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "scheduled_workouts.json"),
  );
  for (const sw of scheduled) {
    isoToDate(sw, ["date"]);
    await sql`
      INSERT INTO scheduled_workouts (
        id, user_id, template_id, name, date, exercises,
        calendar_event_id, routine_instance_id, routine_day_index
      )
      VALUES (
        ${sw.id as string},
        ${remap(sw.user_id as string)}::uuid,
        ${(sw.template_id as string) ?? null},
        ${sw.name as string},
        ${sw.date as Date},
        ${sql.json(sw.exercises as unknown)},
        ${(sw.calendar_event_id as string) ?? null},
        ${(sw.routine_instance_id as string) ?? null},
        ${(sw.routine_day_index as number) ?? null}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${scheduled.length} scheduled_workouts\n`);

  // 8. completed_workouts
  console.log("→ completed_workouts");
  const completed = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "completed_workouts.json"),
  );
  for (const cw of completed) {
    isoToDate(cw, ["completed_at"]);
    await sql`
      INSERT INTO completed_workouts (
        id, user_id, template_id, display_id, name, exercises,
        completed_at, calendar_event_id, routine_instance_id, routine_day_index
      )
      VALUES (
        ${cw.id as string},
        ${remap(cw.user_id as string)}::uuid,
        ${(cw.template_id as string) ?? null},
        ${cw.display_id as string},
        ${cw.name as string},
        ${sql.json(cw.exercises as unknown)},
        ${cw.completed_at as Date},
        ${(cw.calendar_event_id as string) ?? null},
        ${(cw.routine_instance_id as string) ?? null},
        ${(cw.routine_day_index as number) ?? null}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${completed.length} completed_workouts\n`);

  // 9. active_workouts (currently 0 rows, but handle just in case)
  console.log("→ active_workouts");
  const active = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "active_workouts.json"),
  );
  for (const a of active) {
    isoToDate(a, ["updated_at"]);
    await sql`
      INSERT INTO active_workouts (id, user_id, workout_data, tracking_progress, updated_at)
      VALUES (
        ${a.id as string},
        ${remap(a.user_id as string)}::uuid,
        ${sql.json(a.workout_data as unknown)},
        ${a.tracking_progress ? sql.json(a.tracking_progress as unknown) : null},
        ${a.updated_at as Date}
      )
      ON CONFLICT (user_id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${active.length} active_workouts\n`);

  // 10. user_settings
  console.log("→ user_settings");
  const userSettings = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "user_settings.json"),
  );
  for (const us of userSettings) {
    await sql`
      INSERT INTO user_settings (
        id, user_id, selected_calendar_id, selected_calendar_name, weight_unit
      )
      VALUES (
        ${us.id as string},
        ${remap(us.user_id as string)}::uuid,
        ${(us.selected_calendar_id as string) ?? null},
        ${(us.selected_calendar_name as string) ?? null},
        ${(us.weight_unit as string) ?? "lbs"}
      )
      ON CONFLICT (user_id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${userSettings.length} user_settings\n`);

  // 11. exercise_goals
  console.log("→ exercise_goals");
  const goals = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "exercise_goals.json"),
  );
  for (const g of goals) {
    isoToDate(g, ["created_at"]);
    await sql`
      INSERT INTO exercise_goals (
        id, user_id, exercise_id, exercise_name, target_reps, period, created_at
      )
      VALUES (
        ${g.id as string},
        ${remap(g.user_id as string)}::uuid,
        ${g.exercise_id as string},
        ${g.exercise_name as string},
        ${g.target_reps as number},
        ${g.period as string},
        ${g.created_at as Date}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${goals.length} exercise_goals\n`);

  // 12. google_calendar_tokens
  console.log("→ google_calendar_tokens");
  const tokens = loadJson<Array<Record<string, unknown>>>(
    join(snapshotDir, "google_calendar_tokens.json"),
  );
  for (const t of tokens) {
    isoToDate(t, ["expires_at", "connected_at"]);
    await sql`
      INSERT INTO google_calendar_tokens (
        id, user_id, refresh_token, access_token, expires_at, connected_at
      )
      VALUES (
        ${t.id as string},
        ${remap(t.user_id as string)}::uuid,
        ${t.refresh_token as string},
        ${(t.access_token as string) ?? null},
        ${(t.expires_at as Date) ?? null},
        ${t.connected_at as Date}
      )
      ON CONFLICT (user_id) DO NOTHING
    `;
  }
  console.log(`  ✓ ${tokens.length} google_calendar_tokens\n`);

  console.log("✓ All data imported.");
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
