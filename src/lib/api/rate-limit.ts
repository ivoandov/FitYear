import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiUsage } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/auth";

/**
 * DB-backed per-user daily quota for paid endpoints (Anthropic / Vertex Imagen).
 * No new infra: one row per (userId, UTC day, kind), atomically incremented.
 *
 * Pre-increment: we count the call BEFORE the paid work runs, so a provider
 * failure still counts against abuse (someone can't hammer a failing paid call
 * for free). The trade-off is a user occasionally "spends" a unit on a provider
 * error; acceptable for an abuse ceiling with generous limits.
 *
 * Throws ApiError(429) once the running count exceeds `limit`. `limit` calls
 * succeed (count 1..limit); the (limit+1)th throws.
 */
export async function enforceDailyQuota(
  userId: string,
  kind: string,
  limit: number,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10); // UTC calendar day
  const [row] = await db
    .insert(aiUsage)
    .values({ userId, day, kind, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day, aiUsage.kind],
      set: { count: sql`${aiUsage.count} + 1` },
    })
    .returning({ count: aiUsage.count });

  if (row && row.count > limit) {
    throw new ApiError(
      429,
      `Daily limit reached for ${kind}. Try again tomorrow.`,
    );
  }
}
