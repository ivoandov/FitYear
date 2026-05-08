/**
 * Batch-regenerate exercise images via Imagen 4 (Vertex AI).
 *
 *   pnpm tsx scripts/regenerate-exercise-images.ts                # all exercises with images
 *   pnpm tsx scripts/regenerate-exercise-images.ts --only-png     # only the originally-PNG batch
 *   pnpm tsx scripts/regenerate-exercise-images.ts --limit 3      # cap to N (smoke before full run)
 *   pnpm tsx scripts/regenerate-exercise-images.ts --dry-run      # list what would run, no API calls
 *
 * Old GCS object is left in place (cheap to keep, lets us roll back by
 * pointing image_url back at the previous filename).
 *
 * Cost: $0.04 per image at imagen-4.0-generate-001. ~$3.40 for all 85.
 */

import "dotenv/config";
import postgres from "postgres";
import { regenerateExerciseImage } from "../src/lib/imagen";

interface Args {
  onlyPng: boolean;
  limit: number | null;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1] ?? "0", 10) : null;
  return {
    onlyPng: argv.includes("--only-png"),
    limit: limit && limit > 0 ? limit : null,
    dryRun: argv.includes("--dry-run"),
  };
}

async function main() {
  const args = parseArgs();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL not set");
  const sql = postgres(dbUrl);

  // The DB stores legacy paths like /generated_images/foo.jpg or
  // /objects/public/exercises/foo.jpg — anything with image_url IS NOT NULL
  // counts as "has an image".
  const filter = args.onlyPng
    ? sql`AND image_url LIKE '%.png'`
    : sql`AND image_url IS NOT NULL AND image_url != ''`;

  const rows = await sql<{ id: string; name: string; description: string | null }[]>`
    SELECT id, name, description
    FROM exercises
    WHERE 1=1 ${filter}
    ORDER BY name
    ${args.limit ? sql`LIMIT ${args.limit}` : sql``}
  `;

  console.log(`Mode: ${args.dryRun ? "DRY-RUN" : "APPLY"}`);
  console.log(`Filter: ${args.onlyPng ? "only-png" : "any image"}`);
  console.log(`Found ${rows.length} exercise(s) to regenerate.\n`);

  if (args.dryRun) {
    rows.forEach((r) => console.log(`  - ${r.name} (${r.id})`));
    await sql.end();
    return;
  }

  let ok = 0;
  let failed = 0;
  let totalBytes = 0;
  const failures: Array<{ name: string; id: string; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const ex = rows[i];
    const tag = `[${i + 1}/${rows.length}]`;
    process.stdout.write(`${tag} ${ex.name}... `);
    try {
      const start = Date.now();
      const result = await regenerateExerciseImage({
        exerciseId: ex.id,
        exerciseName: ex.name,
        description: ex.description,
      });
      await sql`
        UPDATE exercises
        SET image_url = ${result.imageUrl}
        WHERE id = ${ex.id}
      `;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      ok++;
      totalBytes += result.sizeBytes;
      console.log(`✓ ${(result.sizeBytes / 1024).toFixed(0)} KB (${elapsed}s)`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      failures.push({ name: ex.name, id: ex.id, error: msg });
      console.log(`✗ ${msg.slice(0, 80)}`);
    }
  }

  console.log(`\n--- summary ---`);
  console.log(`ok:     ${ok}`);
  console.log(`failed: ${failed}`);
  console.log(`total bytes uploaded: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`approx cost: $${(ok * 0.04).toFixed(2)} at $0.04/image`);

  if (failures.length) {
    console.log(`\nfailures:`);
    failures.forEach((f) => console.log(`  - ${f.name} (${f.id}): ${f.error}`));
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
