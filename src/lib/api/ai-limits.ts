/**
 * Daily ceilings for the paid AI routes, kept together so the relationship
 * between them stays visible.
 *
 * The program builder is one metered skeleton call plus one call per phase.
 * The phase ceiling is derived, not guessed: it must exceed
 * `PROGRAM_BUILD_DAILY_LIMIT * MAX_PROGRAM_PHASES` so that anyone who still has
 * skeleton budget is guaranteed to have enough phase budget to FINISH the build
 * they just started. A user can therefore never be stranded mid-build by the
 * quota; only a caller looping the phase endpoint directly can reach it.
 *
 * `build-quota.test.ts` asserts that invariant so tuning one number in
 * isolation cannot silently break it.
 */

/** Program builds (skeleton calls) per user per UTC day. */
export const PROGRAM_BUILD_DAILY_LIMIT = 15;

/** Hard cap on phases in one skeleton; also bounds the cost of a single build. */
export const MAX_PROGRAM_PHASES = 8;

/** Retry headroom: the quota pre-increments, so a provider error costs a unit. */
export const PHASE_RETRY_HEADROOM = 80;

export const PHASE_CALL_DAILY_LIMIT =
  PROGRAM_BUILD_DAILY_LIMIT * MAX_PROGRAM_PHASES + PHASE_RETRY_HEADROOM;
