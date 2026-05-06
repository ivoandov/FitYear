/**
 * Phase 4 step: best-effort migrate exercise images from Replit's bucket
 * to our new GCS bucket.
 *
 * Reads every `exercises.image_url` that looks like `/objects/public/...`,
 * fetches it via the still-running Replit instance, uploads to GCS under
 * the same object key.
 *
 * Idempotent: skips images already present in the bucket.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import postgres from "postgres";
import { Storage } from "@google-cloud/storage";

const REPLIT_BASE = "https://fityear.replit.app";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const projectId = process.env.GCP_PROJECT_ID;
  const bucketName = process.env.GCS_BUCKET_NAME;
  const b64 = process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64;
  if (!dbUrl || !projectId || !bucketName || !b64) {
    throw new Error("Missing DATABASE_URL / GCP_PROJECT_ID / GCS_BUCKET_NAME / GCS_SERVICE_ACCOUNT_JSON_BASE64");
  }

  const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const storage = new Storage({ projectId, credentials });
  const bucket = storage.bucket(bucketName);

  const sql = postgres(dbUrl, { prepare: false, ssl: "require", max: 1 });

  const rows = await sql`
    SELECT id, name, image_url
    FROM exercises
    WHERE image_url IS NOT NULL
      AND (image_url LIKE '/objects/%' OR image_url LIKE '/generated_images/%')
  `;

  console.log(`\nFound ${rows.length} exercise images with legacy paths.\n`);

  let migrated = 0,
    skipped = 0,
    failed = 0;

  for (const row of rows) {
    const legacyPath = row.image_url as string;
    const objectName = legacyPath.startsWith("/objects/public/")
      ? legacyPath.replace(/^\/objects\/public\//, "")
      : legacyPath.startsWith("/objects/")
        ? legacyPath.replace(/^\/objects\//, "")
        : `exercises/${legacyPath.replace(/^\/generated_images\//, "")}`;

    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (exists) {
      skipped++;
      continue;
    }

    const fetchUrl = `${REPLIT_BASE}${legacyPath}`;
    try {
      const res = await fetch(fetchUrl, { redirect: "follow" });
      if (!res.ok) {
        console.log(`  ✗ ${row.name.padEnd(36)} ${res.status} ${res.statusText}`);
        failed++;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/jpeg";
      await file.save(buf, { contentType, resumable: false });
      console.log(`  ✓ ${row.name.padEnd(36)} ${(buf.length / 1024).toFixed(1)} KB`);
      migrated++;
    } catch (e) {
      console.log(`  ✗ ${row.name.padEnd(36)} ${(e as Error).message}`);
      failed++;
    }
  }

  await sql.end();

  console.log(
    `\nDone. migrated=${migrated} already-in-bucket=${skipped} failed=${failed} total=${rows.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
