/**
 * One-off: garbage-collect orphaned objects under gs://fityear-uploads/exercises/.
 *
 * After the Imagen 4 regen batch, the previous GCS objects were left in place
 * for rollback. Now safe to delete: any object not currently referenced by
 * exercises.image_url is unreachable.
 *
 * Pass --apply to actually delete; default is dry-run.
 */
import { config } from "dotenv";
config({ path: "./.env.local" });
import postgres from "postgres";
import { Storage } from "@google-cloud/storage";

const APPLY = process.argv.includes("--apply");

function objectNameFromImageUrl(url: string | null): string | null {
  if (!url) return null;
  // Two URL shapes used in DB:
  //   /api/objects/exercises/<file>
  //   /objects/public/exercises/<file>     (legacy)
  //   /generated_images/<file>             (older legacy)
  const m =
    /\/objects\/(?:public\/)?exercises\/([^?#]+)$/.exec(url) ||
    /\/api\/objects\/exercises\/([^?#]+)$/.exec(url) ||
    /\/generated_images\/([^?#]+)$/.exec(url);
  return m ? `exercises/${m[1]}` : null;
}

async function main() {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error("GCS_BUCKET_NAME missing");

  // Materialize SA key from base64 env to /tmp (same pattern as src/lib/imagen.ts).
  const b64 = process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error("GCS_SERVICE_ACCOUNT_JSON_BASE64 missing");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const keyPath = path.join("/tmp", "fityear-storage-key.json");
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, Buffer.from(b64, "base64").toString("utf8"));
  }

  const storage = new Storage({ keyFilename: keyPath });
  const bucket = storage.bucket(bucketName);

  console.log(`Listing gs://${bucketName}/exercises/ ...`);
  const [files] = await bucket.getFiles({ prefix: "exercises/" });
  const objectNames = files.map((f) => f.name);
  console.log(`  ${objectNames.length} objects in bucket`);

  console.log("Reading exercises.image_url from DB ...");
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const rows = await sql<{ image_url: string | null }[]>`
    SELECT image_url FROM exercises WHERE image_url IS NOT NULL
  `;
  const referenced = new Set<string>();
  let unparsable = 0;
  for (const r of rows) {
    const name = objectNameFromImageUrl(r.image_url);
    if (name) referenced.add(name);
    else unparsable++;
  }
  console.log(`  ${rows.length} rows; ${referenced.size} parsed object names; ${unparsable} unparsable`);
  await sql.end();

  const orphans = objectNames.filter((n) => !referenced.has(n));
  console.log(`\nOrphans: ${orphans.length}`);
  for (const o of orphans.slice(0, 20)) console.log("  -", o);
  if (orphans.length > 20) console.log(`  ... +${orphans.length - 20} more`);

  if (!APPLY) {
    console.log("\n(dry-run; pass --apply to delete)");
    return;
  }

  console.log("\nDeleting ...");
  let ok = 0;
  let failed = 0;
  for (const name of orphans) {
    try {
      await bucket.file(name).delete();
      ok++;
      if (ok % 20 === 0) console.log(`  ${ok}/${orphans.length} deleted`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${name}:`, (e as Error).message);
    }
  }
  console.log(`\nDone. Deleted ${ok}, failed ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
