/**
 * Smoke-test Imagen 4 via Vertex AI (instead of AI Studio).
 * Auth: writes the GCS_SERVICE_ACCOUNT_JSON_BASE64 service account to a
 * temp file and points GOOGLE_APPLICATION_CREDENTIALS at it. Same SA
 * is used for GCS uploads, now also has aiplatform.user.
 *
 *   pnpm tsx scripts/imagen-smoke-test-vertex.ts "Bench Press"
 */

import "dotenv/config";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

const STYLE_PREFIX =
  "Editorial fitness illustration, single athletic figure performing the exercise, clean modern gym setting, neutral muted background, balanced studio lighting, photographic style, 3/4 angled view, full body in frame, centered composition. Crisp focus on form and posture. No text, no watermarks, no logos.";

async function setupVertexAuth(): Promise<void> {
  const b64 = process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error("GCS_SERVICE_ACCOUNT_JSON_BASE64 not set");
  const keyPath = path.join(os.tmpdir(), `fityear-sa-${process.pid}.json`);
  const json = Buffer.from(b64, "base64").toString("utf8");
  await fs.writeFile(keyPath, json, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
}

async function main() {
  const exerciseName = process.argv[2] ?? "Bench Press";
  const project = process.env.GCP_PROJECT_ID ?? "fityear";
  const location = process.env.VERTEX_AI_LOCATION ?? "us-central1";

  await setupVertexAuth();

  console.log(`Generating via Vertex AI (${project}/${location}): "${exerciseName}"`);

  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
  const prompt = `${STYLE_PREFIX}\n\nSubject: ${exerciseName}.`;

  const start = Date.now();
  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio: "1:1",
    },
  });
  const elapsed = Date.now() - start;

  const generatedImages = response.generatedImages;
  if (!generatedImages?.length) {
    throw new Error(`No images returned. Response: ${JSON.stringify(response)}`);
  }
  const b64Img = generatedImages[0].image?.imageBytes;
  if (!b64Img) throw new Error("No imageBytes in response");

  const rawBuf = Buffer.from(b64Img, "base64");
  const optimized = await sharp(rawBuf)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const slug = exerciseName.replace(/\s+/g, "_");
  const optPath = path.join("/tmp", `imagen-vertex-${slug}-opt.jpg`);
  await fs.writeFile(optPath, optimized);

  console.log(`✓ generated in ${elapsed} ms via Vertex AI`);
  console.log(`  optimized: ${optPath} (${(optimized.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
