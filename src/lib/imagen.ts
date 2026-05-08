import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { getBucket } from "@/lib/gcs";

const STYLE_PREFIX =
  "Editorial fitness illustration, single athletic figure performing the exercise, clean modern gym setting, neutral muted background, balanced studio lighting, photographic style, 3/4 angled view, full body in frame, centered composition. Crisp focus on form and posture. No text, no watermarks, no logos.";

const MODEL = "imagen-4.0-generate-001";
const MAX_WIDTH = 800;
const JPEG_QUALITY = 82;

let credsWritten = false;
let credsPath = "";

/**
 * Vertex AI authenticates via Application Default Credentials, which the
 * Google auth chain reads from GOOGLE_APPLICATION_CREDENTIALS. Vercel doesn't
 * give us a JSON file path, so we materialize the base64 service-account
 * blob to /tmp once per cold start and point the env var at it.
 */
async function ensureCreds(): Promise<void> {
  if (credsWritten) return;
  const b64 = process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) {
    throw new Error("GCS_SERVICE_ACCOUNT_JSON_BASE64 not set");
  }
  credsPath = path.join(os.tmpdir(), "fityear-sa.json");
  await fs.writeFile(credsPath, Buffer.from(b64, "base64").toString("utf8"), {
    mode: 0o600,
  });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
  credsWritten = true;
}

let cachedClient: GoogleGenAI | null = null;
async function getClient(): Promise<GoogleGenAI> {
  if (cachedClient) return cachedClient;
  await ensureCreds();
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.VERTEX_AI_LOCATION ?? "us-central1";
  if (!project) throw new Error("GCP_PROJECT_ID not set");
  cachedClient = new GoogleGenAI({ vertexai: true, project, location });
  return cachedClient;
}

export interface RegenerateResult {
  /** GCS object name, e.g. "exercises/Barbell_Squat_<hash>.jpg" */
  objectName: string;
  /** Stored URL shape — what to write into exercises.image_url */
  imageUrl: string;
  /** Final JPG byte size after sharp pipe */
  sizeBytes: number;
}

/**
 * Generate a new exercise image with Imagen 4, optimize it (sharp/mozjpeg
 * @ 800w q82), and upload to the GCS bucket. Returns the GCS object name
 * and the legacy-shape URL that exercises.image_url stores.
 */
export async function regenerateExerciseImage(opts: {
  exerciseId: string;
  exerciseName: string;
  description?: string | null;
  /** Optional override; defaults to the brand-style prefix + name */
  promptOverride?: string;
}): Promise<RegenerateResult> {
  const { exerciseId, exerciseName, description, promptOverride } = opts;
  const ai = await getClient();

  const userPrompt = promptOverride
    ? promptOverride
    : `Subject: ${exerciseName}.${description ? ` ${description}` : ""}`;
  const prompt = `${STYLE_PREFIX}\n\n${userPrompt}`;

  const response = await ai.models.generateImages({
    model: MODEL,
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: "16:9",
    },
  });

  const generated = response.generatedImages;
  if (!generated?.length) {
    throw new Error("Imagen returned no images");
  }
  const b64 = generated[0].image?.imageBytes;
  if (!b64) throw new Error("Imagen response missing imageBytes");

  const rawBuf = Buffer.from(b64, "base64");
  const optimized = await sharp(rawBuf)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  // Hash-suffixed filename to dodge browser caches when an exercise gets
  // regenerated. Also matches the existing legacy naming (foo_<8char>.jpg).
  const slug = exerciseName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const stamp = Date.now().toString(16).slice(-8);
  const objectName = `exercises/${slug}_${exerciseId.slice(0, 4)}${stamp}.jpg`;

  await getBucket()
    .file(objectName)
    .save(optimized, {
      contentType: "image/jpeg",
      resumable: false,
      metadata: {
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

  // Match the legacy DB shape so the exercises route's rewriter handles it
  // the same as everything else: `/objects/public/<gcs-object-name>`.
  const imageUrl = `/objects/public/${objectName}`;

  return { objectName, imageUrl, sizeBytes: optimized.length };
}
