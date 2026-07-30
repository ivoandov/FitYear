import { describe, it, expect } from "vitest";
import {
  PROGRAM_BUILD_DAILY_LIMIT,
  MAX_PROGRAM_PHASES,
  PHASE_CALL_DAILY_LIMIT,
} from "@/lib/api/ai-limits";
import { signBuildToken, verifyBuildToken } from "@/lib/api/build-token";

// The quota must never strand a real user mid-build. Tuning any one of these
// numbers in isolation is the way that guarantee would silently rot.
describe("program-phase quota invariant", () => {
  it("allows every skeleton the daily limit permits to finish all its phases", () => {
    expect(PHASE_CALL_DAILY_LIMIT).toBeGreaterThanOrEqual(
      PROGRAM_BUILD_DAILY_LIMIT * MAX_PROGRAM_PHASES,
    );
  });

  it("leaves a full build's worth of headroom after the last allowed skeleton", () => {
    // Worst case: the first 14 builds each burned the maximum phase budget.
    const spentBeforeFinalBuild =
      (PROGRAM_BUILD_DAILY_LIMIT - 1) * MAX_PROGRAM_PHASES;
    const remaining = PHASE_CALL_DAILY_LIMIT - spentBeforeFinalBuild;
    expect(remaining).toBeGreaterThanOrEqual(MAX_PROGRAM_PHASES);
  });
});

describe("build token", () => {
  const secret = "test-secret-key";
  const user = "11111111-1111-1111-1111-111111111111";
  const other = "22222222-2222-2222-2222-222222222222";

  function withSecret<T>(fn: () => T): T {
    const prev = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = secret;
    try {
      return fn();
    } finally {
      process.env.SUPABASE_SECRET_KEY = prev;
    }
  }

  it("round-trips the phase count for the issuing user", () => {
    withSecret(() => {
      const token = signBuildToken(user, 4);
      expect(verifyBuildToken(token, user)).toBe(4);
    });
  });

  it("rejects a token replayed by another user", () => {
    withSecret(() => {
      const token = signBuildToken(user, 4);
      expect(() => verifyBuildToken(token, other)).toThrow();
    });
  });

  it("rejects a tampered phase count", () => {
    withSecret(() => {
      const token = signBuildToken(user, 4);
      const [encoded, mac] = token.split(".");
      const payload = Buffer.from(encoded, "base64url").toString();
      const forged = Buffer.from(payload.replace(".4.", ".99.")).toString("base64url");
      expect(() => verifyBuildToken(`${forged}.${mac}`, user)).toThrow();
    });
  });

  it("rejects a malformed token", () => {
    withSecret(() => {
      expect(() => verifyBuildToken("garbage", user)).toThrow();
      expect(() => verifyBuildToken("a.b.c", user)).toThrow();
    });
  });
});
