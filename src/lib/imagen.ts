import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { getBucket } from "@/lib/gcs";

const STYLE_PREFIX =
  "Editorial fitness illustration, single athletic figure performing the exercise, clean modern gym setting, neutral muted background, balanced studio lighting, photographic style, 3/4 angled view, full body in frame, centered composition. Crisp focus on form and posture. No text, no watermarks, no logos.";

// Image generation moved off the Imagen `generateImages` API (2026-08-25).
// Every `imagen-*` publisher model started returning 404 NOT_FOUND for this
// project - 4.0-generate-001/002, the fast + ultra variants, the 06-06 preview
// and even 3.0-generate-002 - and the SDK now marks `generateImages` itself
// deprecated in favour of `generateContent` with an image-capable model. That
// broke exercise-image regeneration in production for every user.
//
// `gemini-2.5-flash-image` is what this project actually has access to
// (verified against both us-central1 and global). It returns PNG bytes as an
// inlineData part rather than the old `generatedImages` array.
const MODEL = "gemini-2.5-flash-image";

// The catalog is brand-locked to 16:9 (it matches the card thumbnail crop, and
// mixing ratios across the catalog looks uneven). This model defaults to a
// SQUARE 1024x1024 unless the aspect ratio is set explicitly, so keep this -
// dropping it silently changes the shape of every new image.
const ASPECT_RATIO = "16:9";
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

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: ASPECT_RATIO },
    },
  });

  // The image comes back as an inlineData part, not a `generatedImages` array.
  // A refusal or safety block returns text parts instead of an image, so treat
  // a missing image part as a real failure rather than reading past it.
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) {
    const text = parts
      .map((p) => p.text)
      .filter(Boolean)
      .join(" ")
      .slice(0, 200);
    throw new Error(
      `Image model returned no image${text ? `: ${text}` : ""}`,
    );
  }

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
