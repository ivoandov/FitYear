/**
 * Seed / upsert built-in (public, userId === NULL) exercises into Supabase.
 *
 * Source: a JSON file at the path passed in argv[2], or the default
 * `webapp/migration/builtin-exercises.seed.json`. Format:
 *
 *   [
 *     {
 *       "id"?: "uuid",                 // optional; if missing, name-based dedupe
 *       "name": "Bench Press",
 *       "muscleGroups": ["Chest","Triceps"],
 *       "exerciseType": "weight_reps", // or "distance_time"
 *       "isAssisted"?: false,
 *       "description"?: "...",
 *       "imageUrl"?: "/objects/public/exercises/bench-press.jpg"
 *     }, ...
 *   ]
 *
 * Behaviour:
 *   - Match by id when provided; otherwise by (name, userId IS NULL).
 *   - INSERT new rows; UPDATE existing ones (name, muscleGroups, exerciseType,
 *     isAssisted, description, imageUrl). Idempotent — safe to re-run.
 *   - userId is always NULL for built-ins.
 *
 * Run:
 *   cd webapp
 *   npx tsx scripts/seed-builtin-exercises.ts                      # dry run, default path
 *   npx tsx scripts/seed-builtin-exercises.ts ./path/to/file.json
 *   npx tsx scripts/seed-builtin-exercises.ts ... --apply
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "dotenv";
import { db } from "../src/lib/db";
import { exercises } from "../src/lib/db/schema";

config({ path: resolve(process.cwd(), ".env.local") });

type SeedExercise = {
  id?: string;
  name: string;
  muscleGroups: string[];
  exerciseType?: "weight_reps" | "distance_time";
  isAssisted?: boolean;
  description?: string;
  imageUrl?: string | null;
};

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const path = args.find((a) => !a.startsWith("--")) ??
    resolve(process.cwd(), "migration/builtin-exercises.seed.json");

  let rows: SeedExercise[];
  try {
    rows = JSON.parse(readFileSync(path, "utf8")) as SeedExercise[];
  } catch (e) {
    console.error(`Could not read seed file at ${path}`);
    console.error(`Tip: pass a path as the first argument, e.g.\n  npx tsx scripts/seed-builtin-exercises.ts ./my-exercises.json`);
    throw e;
  }

  console.log(`MODE: ${apply ? "APPLY (will write)" : "DRY RUN"}`);
  console.log(`Source: ${path}`);
  console.log(`Rows in source: ${rows.length}\n`);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const seed of rows) {
    if (!seed.name) {
      console.log(`  SKIP (no name): ${JSON.stringify(seed)}`);
      continue;
    }
    // Resolve existing row
    let existing;
    if (seed.id) {
      [existing] = await db
        .select()
        .from(exercises)
        .where(eq(exercises.id, seed.id))
        .limit(1);
    } else {
      [existing] = await db
        .select()
        .from(exercises)
        .where(and(eq(exercises.name, seed.name), isNull(exercises.userId)))
        .limit(1);
    }

    const payload = {
      name: seed.name,
      muscleGroups: seed.muscleGroups ?? [],
      exerciseType: seed.exerciseType ?? "weight_reps",
      isAssisted: seed.isAssisted ?? false,
      description: seed.description ?? "", // schema requires non-null
      imageUrl: seed.imageUrl ?? null,
      userId: null,
    };

    if (!existing) {
      console.log(`  ${apply ? "INSERT" : "would-insert"}: ${seed.name}`);
      if (apply) {
        await db.insert(exercises).values({ ...payload, ...(seed.id ? { id: seed.id } : {}) });
      }
      inserted++;
      continue;
    }

    const diff: string[] = [];
    if (existing.name !== payload.name) diff.push("name");
    if (JSON.stringify(existing.muscleGroups ?? []) !== JSON.stringify(payload.muscleGroups))
      diff.push("muscleGroups");
    if (existing.exerciseType !== payload.exerciseType) diff.push("exerciseType");
    if ((existing.isAssisted ?? false) !== payload.isAssisted) diff.push("isAssisted");
    // Only update description / imageUrl when seed actually provided one.
    // Avoids wiping AI-generated content on a re-seed.
    if (seed.description !== undefined && existing.description !== seed.description)
      diff.push("description");
    if (seed.imageUrl !== undefined && existing.imageUrl !== payload.imageUrl)
      diff.push("imageUrl");

    if (diff.length === 0) {
      unchanged++;
      continue;
    }

    console.log(`  ${apply ? "UPDATE" : "would-update"} ${seed.name} (${diff.join(", ")})`);
    if (apply) {
      const setPayload: Record<string, unknown> = {
        name: payload.name,
        muscleGroups: payload.muscleGroups,
        exerciseType: payload.exerciseType,
        isAssisted: payload.isAssisted,
      };
      if (seed.description !== undefined) setPayload.description = payload.description;
      if (seed.imageUrl !== undefined) setPayload.imageUrl = payload.imageUrl;
      await db.update(exercises).set(setPayload).where(eq(exercises.id, existing.id));
    }
    updated++;
  }

  console.log(
    `\nDone. inserted=${inserted}  updated=${updated}  unchanged=${unchanged}  total=${rows.length}`,
  );
  if (!apply) console.log("Dry run. Re-run with --apply to write.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
