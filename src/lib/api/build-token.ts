import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api/auth";

/**
 * Binds a stage-2 program-phase call to a real stage-1 skeleton call.
 *
 * The segmented builder is one metered skeleton call followed by N unmetered
 * per-phase calls (a build costs one unit, per FITBOT_TECH_SPEC 2.5). Nothing
 * used to tie the two together, so the phase endpoint accepted any hand-written
 * skeleton and ran an unmetered paid Sonnet call as many times as it was asked.
 *
 * The skeleton route now issues a short-lived signed token naming the caller
 * and how many phases the build has; the phase route refuses to run without a
 * valid one. A phase call therefore cannot exist without a skeleton call having
 * been charged first.
 *
 * The key derives from SUPABASE_SECRET_KEY (server-only, already present in
 * every environment) so this adds no new secret to provision. It never leaves
 * the server and is not reversible into that key.
 */

const TTL_MS = 30 * 60 * 1000; // a build runs a few minutes; 30 covers retries

function key(): Buffer {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new ApiError(500, "AI is not configured");
  return createHmac("sha256", secret).update("fitbot-build-token-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

export function signBuildToken(userId: string, phaseCount: number): string {
  const payload = `${userId}.${phaseCount}.${Date.now()}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/**
 * Returns the phase count the token was issued for. Throws if the token is
 * missing, malformed, tampered with, expired, or belongs to another user.
 */
export function verifyBuildToken(token: string, userId: string): number {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new ApiError(400, "Start the program build again.");
  }
  const [encoded, mac] = parts;
  const payload = Buffer.from(encoded, "base64url").toString();
  const expected = sign(payload);

  // Constant-time compare; equal lengths are required before timingSafeEqual.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(400, "Start the program build again.");
  }

  const [tokenUserId, phaseCountRaw, issuedAtRaw] = payload.split(".");
  const phaseCount = Number(phaseCountRaw);
  const issuedAt = Number(issuedAtRaw);
  if (!tokenUserId || !Number.isFinite(phaseCount) || !Number.isFinite(issuedAt)) {
    throw new ApiError(400, "Start the program build again.");
  }
  // Scoped to the caller so a token cannot be replayed from another account.
  if (tokenUserId !== userId) {
    throw new ApiError(403, "Start the program build again.");
  }
  if (Date.now() - issuedAt > TTL_MS) {
    throw new ApiError(400, "That program build expired. Please start it again.");
  }
  return phaseCount;
}
