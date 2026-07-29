/**
 * Postgres error helpers. Drizzle/postgres.js wrap the driver error, so the
 * code can sit a few levels down the `cause` chain.
 */

/** 23505 = unique_violation. Used to turn a lost write race into a sane reply. */
export function isUniqueViolation(e: unknown): boolean {
  let cur = e as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; cur && i < 4; i++) {
    if (cur.code === "23505") return true;
    cur = cur.cause as { code?: string; cause?: unknown } | undefined;
  }
  return false;
}
