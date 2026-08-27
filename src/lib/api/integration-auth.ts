import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api/auth";

/**
 * Machine-to-machine auth for the read-only integration endpoints.
 *
 * FitYear had no M2M path at all before this: every route goes through
 * `requireUser()`, which reads the Supabase session COOKIE, so another service
 * had nothing it could present. This adds exactly one narrow door.
 *
 * DESIGN CHOICE WORTH KEEPING: the key is bound to ONE user id, held server
 * side in `INTEGRATION_USER_ID`. The caller does NOT get to name whose data it
 * wants. If it could, this single shared secret would be a master key over
 * every account in a multi-tenant app - one leak would expose all 5 users
 * rather than the one it was issued for. Serving a second consumer means a real
 * grants table (key -> user, revocable, per-key scope), not a query parameter.
 *
 * These endpoints must stay READ-ONLY. A shared secret in someone else's env is
 * a weaker credential than a real user session, so it must never be able to
 * mutate FitYear data.
 */

export interface IntegrationCaller {
  /** The single user this key is authorized to read. */
  userId: string;
}

/** Constant-time compare that does not leak length through early return. */
function secretsMatch(provided: string, expected: string): boolean {
  // HMAC both sides to a fixed 32 bytes first: timingSafeEqual throws on a
  // length mismatch, and branching on that would leak the secret's length.
  const salt = "fityear-integration-key-v1";
  const a = createHmac("sha256", salt).update(provided).digest();
  const b = createHmac("sha256", salt).update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Verify the Authorization header. Throws ApiError on any failure, and never
 * explains WHICH check failed - a caller probing this should learn nothing.
 */
export function requireIntegrationCaller(request: Request): IntegrationCaller {
  const expected = process.env.INTEGRATION_API_KEY;
  const userId = process.env.INTEGRATION_USER_ID;

  // Not provisioned is a server-config state, not an auth failure. 503 so a
  // consumer can tell "you have not set this up" from "your key is wrong".
  if (!expected || !userId) {
    throw new ApiError(503, "Integration access is not configured");
  }
  // A short key would make brute force realistic; refuse to run with one rather
  // than quietly accepting weak protection.
  if (expected.length < 32) {
    throw new ApiError(503, "Integration access is not configured");
  }

  // Two accepted forms: `x-fityear-key: <secret>` (what Liv sends) and the
  // conventional `Authorization: Bearer <secret>`. Same secret, same compare -
  // this is a spelling convenience for the caller, not a second credential.
  const direct = request.headers.get("x-fityear-key");
  const authHeader = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader.trim())?.[1];

  const provided = (direct ?? bearer ?? "").trim();
  if (!provided) {
    throw new ApiError(401, "Unauthorized");
  }

  if (!secretsMatch(provided, expected)) {
    throw new ApiError(401, "Unauthorized");
  }

  return { userId };
}
