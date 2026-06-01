/**
 * Sync user-mutable rows from the legacy Neon DB (Replit) into the new
 * Supabase DB. Idempotent — safe to re-run. Insert order respects FK deps.
 *
 * Tables handled:
 *   exercises          (custom user exercises)
 *   workout_templates  (saved workouts in user's library)
 *   scheduled_workouts (calendar entries on Home)
 *   completed_workouts (logged sessions in History)
 *
 * Mapping rules:
 *   - Neon user_id (varchar legacy id) → Supabase auth.users.uuid via email
 *   - rows whose user_id can't be mapped (e.g. orphan from a deleted Neon user) are skipped
 *   - foreign keys (template_id, routine_instance_id) kept if the parent exists
 *     in Supabase, otherwise NULLed
 *
 * Run: cd webapp && npx tsx scripts/sync-replit-to-supabase.ts            # dry-run
 *      cd webapp && npx tsx scripts/sync-replit-to-supabase.ts --apply    # write
 */
import postgres from "postgres";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const NEON_URL = process.env.LEGACY_NEON_DATABASE_URL;
const SUPA_URL = process.env.DATABASE_URL;
if (!NEON_URL || !SUPA_URL) throw new Error("missing env");

const apply = process.argv.includes("--apply");

const NEON = postgres(NEON_URL, { ssl: "require", max: 1 });
const SUPA = postgres(SUPA_URL, { ssl: "require", max: 1 });

// Override email-to-email mapping for user identities that changed during
// migration. The duplicate ivo.andov@gmail.com auth row was removed from
// Supabase 2026-05-09, but some Replit data was created under that identity
// and belongs to the same person on thebballkid@gmail.com.
const EMAIL_REMAP: Record<string, string> = {
  "ivo.andov@gmail.com": "thebballkid@gmail.com",
};

async function buildUserMap(): Promise<Map<string, string>> {
  const neonUsers = (await NEON<{ id: string; email: string | null }[]>`
    SELECT id, email FROM users
  `) as { id: string; email: string | null }[];
  const supaUsers = (await SUPA<{ id: string; email: string | null }[]>`
    SELECT id::text AS id, email FROM auth.users
  `) as { id: string; email: string | null }[];
  const emailToSupa = new Map(
    supaUsers.filter((u) => u.email).map((u) => [(u.email ?? "").toLowerCase(), u.id]),
  );
  const map = new Map<string, string>();
  for (const u of neonUsers) {
    if (!u.email) continue;
    const lookup = EMAIL_REMAP[u.email.toLowerCase()] ?? u.email.toLowerCase();
    const supaId = emailToSupa.get(lookup);
    if (supaId) map.set(u.id, supaId);
  }
  return map;
}

async function ids(sql: typeof SUPA, table: string): Promise<Set<string>> {
  const rows = (await sql.unsafe(`SELECT id FROM ${table}`)) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

type ExerciseRow = {
  id: string;
  name: string;
  muscle_groups: string[] | null;
  description: string | null;
  exercise_type: string | null;
  is_assisted: boolean | null;
  user_id: string | null;
  is_public: boolean | null;
  image_url: string | null;
};

async function syncExercises(userMap: Map<string, string>) {
  console.log("\n--- exercises ---");
  const cols = (await NEON`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='exercises'
    ORDER BY ordinal_position
  `) as { column_name: string }[];
  const present = new Set(cols.map((c) => c.column_name));
  // Build a SELECT that tolerates missing optional columns on Neon
  const select = [
    "id",
    "name",
    present.has("muscle_groups") ? "muscle_groups" : "ARRAY[]::text[] AS muscle_groups",
    present.has("description") ? "description" : "NULL::text AS description",
    present.has("exercise_type") ? "exercise_type" : "NULL::text AS exercise_type",
    present.has("is_assisted") ? "is_assisted" : "false AS is_assisted",
    "user_id",
    present.has("is_public") ? "is_public" : "false AS is_public",
    present.has("image_url") ? "image_url" : "NULL::text AS image_url",
  ].join(", ");

  const neonRows = (await NEON.unsafe(`SELECT ${select} FROM exercises`)) as ExerciseRow[];
  const supaIdSet = await ids(SUPA, "exercises");
  const missing = neonRows.filter((r) => !supaIdSet.has(r.id));
  console.log(`Neon ${neonRows.length} / Supa ${supaIdSet.size} / missing ${missing.length}`);

  let inserted = 0;
  for (const r of missing) {
    const newUserId = r.user_id ? userMap.get(r.user_id) : null;
    if (r.user_id && !newUserId) {
      console.log(`  SKIP exercise ${r.id} "${r.name}" — neon user_id=${r.user_id} not mappable`);
      continue;
    }
    console.log(`  ${apply ? "INSERT" : "would-insert"} exercise ${r.id} "${r.name}" (user=${newUserId ?? "<public>"})`);
    if (!apply) continue;
    const result = await SUPA`
      INSERT INTO exercises (id, name, muscle_groups, description, exercise_type, is_assisted, user_id, is_public, image_url)
      VALUES (${r.id}, ${r.name}, ${r.muscle_groups as string[]}, ${r.description}, ${r.exercise_type}, ${r.is_assisted ?? false},
              ${newUserId ? SUPA.unsafe(`'${newUserId}'::uuid`) : null}, ${r.is_public ?? false}, ${r.image_url})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length) inserted++;
  }
  if (apply) console.log(`  inserted ${inserted}`);
}

type TemplateRow = {
  id: string;
  name: string;
  exercises: unknown;
  user_id: string | null;
};

async function syncTemplates(userMap: Map<string, string>) {
  console.log("\n--- workout_templates ---");
  const neonRows = (await NEON<TemplateRow[]>`
    SELECT id, name, exercises, user_id FROM workout_templates
  `) as TemplateRow[];
  const supaIdSet = await ids(SUPA, "workout_templates");
  const missing = neonRows.filter((r) => !supaIdSet.has(r.id));
  console.log(`Neon ${neonRows.length} / Supa ${supaIdSet.size} / missing ${missing.length}`);

  let inserted = 0;
  for (const r of missing) {
    const newUserId = r.user_id ? userMap.get(r.user_id) : null;
    if (r.user_id && !newUserId) {
      console.log(`  SKIP template ${r.id} "${r.name}" — neon user_id=${r.user_id} not mappable`);
      continue;
    }
    console.log(`  ${apply ? "INSERT" : "would-insert"} template ${r.id} "${r.name}" (user=${newUserId ?? "<public>"})`);
    if (!apply) continue;
    const result = await SUPA`
      INSERT INTO workout_templates (id, name, exercises, user_id)
      VALUES (${r.id}, ${r.name}, ${SUPA.json(r.exercises as never)},
              ${newUserId ? SUPA.unsafe(`'${newUserId}'::uuid`) : null})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length) inserted++;
  }
  if (apply) console.log(`  inserted ${inserted}`);
}

type ScheduledRow = {
  id: string;
  name: string;
  // Read as text from Neon to bypass postgres-js's JS-Date round-trip, which
  // re-serializes `timestamp without time zone` as local-time and silently
  // drifts the stored value by the script-host TZ offset (we saw 2-8h shifts
  // depending on DST during the initial port). Strings are inserted verbatim.
  date: string;
  exercises: unknown;
  template_id: string | null;
  user_id: string | null;
  calendar_event_id: string | null;
  routine_instance_id: string | null;
  routine_day_index: number | null;
};

async function syncScheduled(userMap: Map<string, string>) {
  console.log("\n--- scheduled_workouts ---");
  const neonRows = (await NEON<ScheduledRow[]>`
    SELECT id, name, date::text AS date, exercises, template_id, user_id, calendar_event_id, routine_instance_id, routine_day_index
    FROM scheduled_workouts
  `) as ScheduledRow[];
  const supaIdSet = await ids(SUPA, "scheduled_workouts");
  const supaTemplates = await ids(SUPA, "workout_templates");
  const supaRoutines = await ids(SUPA, "routine_instances");
  const missing = neonRows.filter((r) => !supaIdSet.has(r.id));
  console.log(`Neon ${neonRows.length} / Supa ${supaIdSet.size} / missing ${missing.length}`);

  let inserted = 0;
  for (const r of missing) {
    const newUserId = r.user_id ? userMap.get(r.user_id) : null;
    if (r.user_id && !newUserId) {
      console.log(`  SKIP scheduled ${r.id} "${r.name}" — neon user_id=${r.user_id} not mappable`);
      continue;
    }
    const tpl = r.template_id && supaTemplates.has(r.template_id) ? r.template_id : null;
    const rout = r.routine_instance_id && supaRoutines.has(r.routine_instance_id) ? r.routine_instance_id : null;
    const flags: string[] = [];
    if (r.template_id && !tpl) flags.push("template_id NULLed");
    if (r.routine_instance_id && !rout) flags.push("routine_instance_id NULLed");
    console.log(
      `  ${apply ? "INSERT" : "would-insert"} scheduled ${r.id} "${r.name}" @${r.date.slice(0, 10)} (user=${newUserId})${flags.length ? `  [${flags.join(", ")}]` : ""}`,
    );
    if (!apply) continue;
    // postgres-js auto-converts ISO-timestamp-looking strings to JS Date and
    // sends them as timestamptz, shifting through the connection's local TZ.
    // Embed via SUPA.unsafe(quoted-and-validated literal) to bypass.
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(r.date)) {
      throw new Error(`Neon row ${r.id} has malformed date: ${r.date}`);
    }
    const tsLiteral = SUPA.unsafe(`'${r.date}'::timestamp`);
    const result = await SUPA`
      INSERT INTO scheduled_workouts (id, user_id, template_id, name, date, exercises, calendar_event_id, routine_instance_id, routine_day_index)
      VALUES (${r.id},
              ${newUserId ? SUPA.unsafe(`'${newUserId}'::uuid`) : null},
              ${tpl}, ${r.name}, ${tsLiteral}, ${SUPA.json(r.exercises as never)},
              ${r.calendar_event_id}, ${rout}, ${r.routine_day_index})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length) inserted++;
  }
  if (apply) console.log(`  inserted ${inserted}`);
}

type CompletedRow = {
  id: string;
  user_id: string | null;
  template_id: string | null;
  display_id: string;
  name: string;
  exercises: unknown;
  // See ScheduledRow.date for why this is string, not Date.
  completed_at: string;
  calendar_event_id: string | null;
  routine_instance_id: string | null;
  routine_day_index: number | null;
};

async function syncCompleted(userMap: Map<string, string>) {
  console.log("\n--- completed_workouts ---");
  const neonRows = (await NEON<CompletedRow[]>`
    SELECT id, user_id, template_id, display_id, name, exercises, completed_at::text AS completed_at,
           calendar_event_id, routine_instance_id, routine_day_index
    FROM completed_workouts
  `) as CompletedRow[];
  const supaIdSet = await ids(SUPA, "completed_workouts");
  const supaTemplates = await ids(SUPA, "workout_templates");
  const supaRoutines = await ids(SUPA, "routine_instances");
  const missing = neonRows.filter((r) => !supaIdSet.has(r.id));
  console.log(`Neon ${neonRows.length} / Supa ${supaIdSet.size} / missing ${missing.length}`);

  let inserted = 0;
  for (const r of missing) {
    const newUserId = r.user_id ? userMap.get(r.user_id) : null;
    if (r.user_id && !newUserId) {
      console.log(`  SKIP completed ${r.id} "${r.name}" — neon user_id=${r.user_id} not mappable`);
      continue;
    }
    const tpl = r.template_id && supaTemplates.has(r.template_id) ? r.template_id : null;
    const rout = r.routine_instance_id && supaRoutines.has(r.routine_instance_id) ? r.routine_instance_id : null;
    const flags: string[] = [];
    if (r.template_id && !tpl) flags.push("template_id NULLed");
    if (r.routine_instance_id && !rout) flags.push("routine_instance_id NULLed");
    console.log(
      `  ${apply ? "INSERT" : "would-insert"} completed ${r.id} "${r.name}" @${r.completed_at.slice(0, 10)} (user=${newUserId})${flags.length ? `  [${flags.join(", ")}]` : ""}`,
    );
    if (!apply) continue;
    // See note on scheduled INSERT — bypass postgres-js's timestamp coercion.
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(r.completed_at)) {
      throw new Error(`Neon row ${r.id} has malformed completed_at: ${r.completed_at}`);
    }
    const tsLiteral = SUPA.unsafe(`'${r.completed_at}'::timestamp`);
    const result = await SUPA`
      INSERT INTO completed_workouts (id, user_id, template_id, display_id, name, exercises, completed_at, calendar_event_id, routine_instance_id, routine_day_index)
      VALUES (${r.id},
              ${newUserId ? SUPA.unsafe(`'${newUserId}'::uuid`) : null},
              ${tpl}, ${r.display_id}, ${r.name}, ${SUPA.json(r.exercises as never)},
              ${tsLiteral}, ${r.calendar_event_id}, ${rout}, ${r.routine_day_index})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    if (result.length) inserted++;
  }
  if (apply) console.log(`  inserted ${inserted}`);
}

async function main() {
  console.log(apply ? "MODE: APPLY (will write)" : "MODE: DRY RUN");
  const userMap = await buildUserMap();
  console.log(`User mapping: ${userMap.size} mapped neon users`);

  // FK order: exercises, then templates, then scheduled/completed (which can reference templates)
  await syncExercises(userMap);
  await syncTemplates(userMap);
  await syncScheduled(userMap);
  await syncCompleted(userMap);

  await NEON.end();
  await SUPA.end();
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
