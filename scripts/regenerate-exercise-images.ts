/**
 * Batch-regenerate exercise images via Imagen 4 (Vertex AI).
 *
 *   pnpm tsx scripts/regenerate-exercise-images.ts                # all exercises with images
 *   pnpm tsx scripts/regenerate-exercise-images.ts --only-png     # only the originally-PNG batch
 *   pnpm tsx scripts/regenerate-exercise-images.ts --missing      # only exercises with NO image yet
 *   pnpm tsx scripts/regenerate-exercise-images.ts --limit 3      # cap to N (smoke before full run)
 *   pnpm tsx scripts/regenerate-exercise-images.ts --dry-run      # list what would run, no API calls
 *
 * Old GCS object is left in place (cheap to keep, lets us roll back by
 * pointing image_url back at the previous filename).
 *
 * Cost: $0.04 per image at imagen-4.0-generate-001. ~$3.40 for all 85.
 *
 * `--missing` is the inverse of the default filter and exists because the
 * catalog grew past the original batch: exercises created by hand, by import or
 * by FitBot never went through the image pipeline, so 36 of 154 rows rendered
 * with no visual at all (measured 2026-09-17). Generation needs only the name
 * and description, both of which every row has, so a missing image is a gap
 * rather than a blocker.
 */

import "dotenv/config";
import postgres from "postgres";
import { regenerateExerciseImage } from "../src/lib/imagen";

interface Args {
  onlyPng: boolean;
  missing: boolean;
  limit: number | null;
  dryRun: boolean;
}

/**
 * Vertex answers 429 RESOURCE_EXHAUSTED under a sustained batch, and the first
 * full run of `--missing` lost 22 of 36 images to it in a burst. The quota is
 * per-minute, so the fix is pacing plus backoff rather than a bigger quota: a
 * gap between calls keeps the burst under the limit, and a retry recovers the
 * ones that still collide. Without both, a batch silently half-completes and
 * the only sign is the failure list scrolling past.
 */
const GAP_MS = 3_000;
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimit(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
}

/** Retry only a rate limit. A prompt or auth failure will not fix itself. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e) || attempt >= MAX_ATTEMPTS) throw e;
      const wait = 10_000 * 2 ** (attempt - 1);
      process.stdout.write(`rate limited, retrying ${label} in ${wait / 1000}s... `);
      await sleep(wait);
    }
  }
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(argv[limitIdx + 1] ?? "0", 10) : null;
  return {
    onlyPng: argv.includes("--only-png"),
    missing: argv.includes("--missing"),
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
  // An empty string counts as missing, not as an image. The column has held
  // both over the catalog's life and a row with '' renders exactly as broken as
  // a row with NULL.
  const filter = args.missing
    ? sql`AND (image_url IS NULL OR image_url = '')`
    : args.onlyPng
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
  const mode = args.missing ? "missing image" : args.onlyPng ? "only-png" : "any image";
  console.log(`Filter: ${mode}`);
  console.log(`Found ${rows.length} exercise(s) to ${args.missing ? "generate" : "regenerate"}.\n`);

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
      const result = await withRetry(
        () =>
          regenerateExerciseImage({
            exerciseId: ex.id,
            exerciseName: ex.name,
            description: ex.description,
          }),
        ex.name,
      );
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
    // Pace the batch. Skipped after the last one so a run does not end on a
    // pointless wait.
    if (i < rows.length - 1) await sleep(GAP_MS);
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
