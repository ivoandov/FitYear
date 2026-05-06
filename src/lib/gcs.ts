import { Storage } from "@google-cloud/storage";

let cachedStorage: Storage | null = null;
let cachedBucket: ReturnType<Storage["bucket"]> | null = null;

function getStorage(): Storage {
  if (cachedStorage) return cachedStorage;

  const projectId = process.env.GCP_PROJECT_ID;
  const b64 = process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64;
  if (!projectId || !b64) {
    throw new Error(
      "GCS not configured (GCP_PROJECT_ID and GCS_SERVICE_ACCOUNT_JSON_BASE64 required)",
    );
  }
  const credentials = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  cachedStorage = new Storage({ projectId, credentials });
  return cachedStorage;
}

export function getBucket() {
  if (cachedBucket) return cachedBucket;
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error("GCS_BUCKET_NAME not set");
  cachedBucket = getStorage().bucket(bucketName);
  return cachedBucket;
}

/**
 * Generate a signed read URL for an object. Returns null if the object doesn't exist.
 */
export async function getSignedReadUrl(
  objectName: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const file = getBucket().file(objectName);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + expiresInSeconds * 1000,
  });
  return url;
}

/**
 * Generate a signed PUT URL the client can upload to directly.
 */
export async function getSignedUploadUrl(
  objectName: string,
  contentType: string,
  expiresInSeconds = 600,
): Promise<string> {
  const file = getBucket().file(objectName);
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + expiresInSeconds * 1000,
    contentType,
  });
  return url;
}

/**
 * Upload a buffer to the bucket directly from the server.
 */
export async function uploadBuffer(
  objectName: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const file = getBucket().file(objectName);
  await file.save(buffer, {
    contentType,
    resumable: false,
  });
}

export function objectExists(objectName: string): Promise<boolean> {
  return getBucket()
    .file(objectName)
    .exists()
    .then(([e]) => e);
}

/**
 * Translate a legacy `/objects/public/exercises/<file>` URL stored in the DB
 * to the GCS object key under our new bucket.
 */
export function legacyImagePathToObjectName(
  imageUrl: string | null | undefined,
): string | null {
  if (!imageUrl) return null;
  // Already a fully-qualified URL — leave alone
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
    return null;
  }
  // Legacy Replit pattern: /objects/public/exercises/foo.jpg
  if (imageUrl.startsWith("/objects/public/")) {
    return imageUrl.replace(/^\/objects\/public\//, "");
  }
  // Local/dev pattern: /generated_images/foo.jpg → exercises/foo.jpg
  if (imageUrl.startsWith("/generated_images/")) {
    return imageUrl.replace(/^\/generated_images\//, "exercises/");
  }
  return null;
}
