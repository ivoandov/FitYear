/**
 * One-shot script to re-encode the 22 oversized PNGs in
 * gs://fityear-uploads/exercises/ as optimized JPGs.
 *
 *   - download each .png from GCS
 *   - re-encode with sharp: max 800px wide, JPEG quality 82 (mozjpeg)
 *   - upload as <same-base>.jpg
 *   - update exercises.image_url in DB to point at .jpg
 *   - delete the .png blob (only after DB update confirmed)
 *
 * Run:
 *   pnpm tsx scripts/optimize-exercise-images.ts            # dry-run, prints size table
 *   pnpm tsx scripts/optimize-exercise-images.ts --apply    # actually do it
 */

import "dotenv/config";
import { Storage } from "@google-cloud/storage";
import postgres from "postgres";
import sharp from "sharp";

const APPLY = process.argv.includes("--apply");
const MAX_WIDTH = 800;
const JPEG_QUALITY = 82;

function loadStorage(): Storage {
  const projectId = process.env.GCP_PROJECT_ID;
  const b64 = process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64;
  if (!projectId || !b64) {
    throw new Error(
      "GCP_PROJECT_ID and GCS_SERVICE_ACCOUNT_JSON_BASE64 must be set in .env.local",
    );
  }
  const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  return new Storage({ projectId, credentials });
}

async function main() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  const dbUrl = process.env.DATABASE_URL;
  if (!bucketName) throw new Error("GCS_BUCKET_NAME not set");
  if (!dbUrl) throw new Error("DATABASE_URL not set");

  const bucket = loadStorage().bucket(bucketName);
  const sql = postgres(dbUrl);

  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Bucket: gs://${bucketName}/exercises/\n`);

  const [files] = await bucket.getFiles({ prefix: "exercises/" });
  const pngs = files.filter((f) => f.name.toLowerCase().endsWith(".png"));
  console.log(`Found ${pngs.length} PNGs to process.\n`);

  let totalBefore = 0;
  let totalAfter = 0;
  const results: Array<{
    name: string;
    beforeKB: number;
    afterKB: number;
    ratio: string;
  }> = [];

  for (const file of pngs) {
    const newName = file.name.replace(/\.png$/i, ".jpg");
    const [metaBefore] = await file.getMetadata();
    const beforeBytes = Number(metaBefore.size ?? 0);
    totalBefore += beforeBytes;

    process.stdout.write(`${file.name} (${(beforeBytes / 1024).toFixed(0)} KB) → `);

    // Download
    const [buf] = await file.download();

    // Re-encode
    const out = await sharp(buf)
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    const afterBytes = out.length;
    totalAfter += afterBytes;
    const ratio = (beforeBytes / afterBytes).toFixed(1);

    process.stdout.write(`${(afterBytes / 1024).toFixed(0)} KB (${ratio}x smaller)\n`);

    results.push({
      name: file.name,
      beforeKB: Math.round(beforeBytes / 1024),
      afterKB: Math.round(afterBytes / 1024),
      ratio,
    });

    if (!APPLY) continue;

    // Upload optimized JPG
    await bucket.file(newName).save(out, {
      contentType: "image/jpeg",
      resumable: false,
      metadata: {
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    // Update DB rows. The DB stores legacy paths like /generated_images/<file>.png
    // OR /objects/public/exercises/<file>.png. We swap .png → .jpg in whichever
    // shape the row uses.
    const oldDbBaseName = file.name.replace(/^exercises\//, "");
    const newDbBaseName = newName.replace(/^exercises\//, "");
    const updated = await sql`
      UPDATE exercises
      SET image_url = REPLACE(image_url, ${oldDbBaseName}, ${newDbBaseName})
      WHERE image_url LIKE ${"%" + oldDbBaseName}
      RETURNING id
    `;
    if (updated.length === 0) {
      console.warn(`  ⚠ no DB row matched ${oldDbBaseName} — rolling back upload`);
      await bucket.file(newName).delete().catch(() => {});
      continue;
    }
    console.log(`  ✓ uploaded ${newName} + updated ${updated.length} DB row(s)`);

    // Delete old PNG only after upload + DB update succeeded
    await file.delete();
    console.log(`  ✓ deleted old ${file.name}`);
  }

  console.log("\n--- summary ---");
  console.log(
    `total before: ${(totalBefore / 1024 / 1024).toFixed(2)} MB across ${pngs.length} files`,
  );
  console.log(
    `total after : ${(totalAfter / 1024 / 1024).toFixed(2)} MB (${(
      totalBefore / totalAfter
    ).toFixed(1)}x smaller)`,
  );
  if (!APPLY) {
    console.log("\nDRY-RUN — re-run with --apply to actually upload + update DB.");
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
