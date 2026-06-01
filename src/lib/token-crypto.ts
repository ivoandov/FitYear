/**
 * AES-256-GCM at-rest encryption for OAuth tokens (Google Calendar refresh +
 * access tokens). Supabase Postgres is already at-rest encrypted, but a leaked
 * row dump would still expose plaintext tokens; this layer makes the row dump
 * useless without the key.
 *
 * Format: `enc:v1:<iv-base64>:<ciphertext-base64>:<authtag-base64>`
 * — versioned so we can rotate algorithms later
 * — base64url-safe-ish (plain base64 is fine since the prefix is a sentinel)
 *
 * Migration: legacy plaintext tokens (no `enc:v1:` prefix) pass through
 * `decryptToken` unchanged. On every read path, after we resolve the
 * plaintext, callers SHOULD re-encrypt and write back so the row gets
 * migrated lazily. The token-refresh listener already runs on every API
 * call, so within one OAuth cycle every user's tokens will be encrypted.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard

/**
 * Feature-flagged: encryption activates only when CALENDAR_TOKEN_ENCRYPTION_KEY
 * is set on the host (Vercel env or local .env.local). Without the key,
 * `encryptToken` is a pass-through — safe rollout, no breakage. Once the key
 * is provisioned, new writes encrypt and existing plaintext rows lazily
 * migrate via the calendar.ts read path.
 */
function getKey(): Buffer | null {
  const raw = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `CALENDAR_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars); got ${buf.length}`,
    );
  }
  return buf;
}

export function isEncryptionEnabled(): boolean {
  return !!process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted; idempotent
  const key = getKey();
  if (!key) return plaintext; // encryption disabled — pass-through
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX.slice(0, -1), // "enc:v1"
    iv.toString("base64"),
    ct.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  // Legacy plaintext rows pass through. They'll get encrypted on next refresh.
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.split(":");
  // Format: enc:v1:<iv>:<ct>:<tag>
  if (parts.length !== 5) {
    throw new Error("Encrypted token has wrong number of segments");
  }
  const [, , ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const key = getKey();
  if (!key) {
    // Row is encrypted but the key isn't configured here — data is unreadable.
    // Surface as a clear runtime error rather than silently returning ciphertext.
    throw new Error(
      "Encrypted calendar token encountered but CALENDAR_TOKEN_ENCRYPTION_KEY is not set",
    );
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}
