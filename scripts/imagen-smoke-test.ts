/**
 * One-off smoke test: hit Imagen 4 with our brand-style prompt for ONE
 * exercise and write the output to /tmp so we can eyeball quality.
 *
 *   pnpm tsx scripts/imagen-smoke-test.ts "Barbell Squat"
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

const STYLE_PREFIX =
  "Editorial fitness illustration, single athletic figure performing the exercise, clean modern gym setting, neutral muted background, balanced studio lighting, photographic style, 3/4 angled view, full body in frame, centered composition. Crisp focus on form and posture. No text, no watermarks, no logos.";

async function main() {
  const exerciseName = process.argv[2] ?? "Barbell Squat";
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_STUDIO_API_KEY not set");

  console.log(`Generating: "${exerciseName}"`);

  const ai = new GoogleGenAI({ apiKey });
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
  const b64 = generatedImages[0].image?.imageBytes;
  if (!b64) throw new Error("No imageBytes in response");

  const rawBuf = Buffer.from(b64, "base64");
  const optimized = await sharp(rawBuf)
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const slug = exerciseName.replace(/\s+/g, "_");
  const rawPath = path.join("/tmp", `imagen-test-${slug}-raw.png`);
  const optPath = path.join("/tmp", `imagen-test-${slug}-opt.jpg`);
  await fs.writeFile(rawPath, rawBuf);
  await fs.writeFile(optPath, optimized);

  console.log(`✓ generated in ${elapsed} ms`);
  console.log(`  raw:       ${rawPath} (${(rawBuf.length / 1024).toFixed(0)} KB)`);
  console.log(`  optimized: ${optPath} (${(optimized.length / 1024).toFixed(0)} KB)`);
  console.log(`\nOpen the .jpg to inspect.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
