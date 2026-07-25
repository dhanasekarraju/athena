import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-test-secret";
process.env.JWT_REFRESH_SECRET ??= "test-secret-test-secret";

const { evaluateRegimeGuard } = await import("./regimeGuard.js");
type TrendVerdict = import("./trendJudge.js").TrendVerdict;

const up: TrendVerdict = {
  trend: "up",
  strength: 70,
  reason: "5m+15m up",
  source: "gemini",
  frames: ["5m", "15m"],
};

describe("evaluateRegimeGuard", () => {
  it("allows CALL on strong up + liquid OI + sane IV", () => {
    const r = evaluateRegimeGuard({
      direction: "BUY_CALL",
      verdict: up,
      openInterest: 200,
      minOpenInterest: 50,
      markIv: 0.55,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks chop structure", () => {
    const r = evaluateRegimeGuard({
      direction: "BUY_CALL",
      verdict: { ...up, trend: "chop" },
      openInterest: 200,
      minOpenInterest: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/chop/i);
  });

  it("blocks rich IV for buyers", () => {
    const r = evaluateRegimeGuard({
      direction: "BUY_CALL",
      verdict: up,
      openInterest: 200,
      minOpenInterest: 50,
      markIv: 1.2,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/IV too rich/i);
  });

  it("blocks thin OI", () => {
    const r = evaluateRegimeGuard({
      direction: "BUY_PUT",
      verdict: { ...up, trend: "down", frames: ["5m"] },
      openInterest: 5,
      minOpenInterest: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/OI/i);
  });

  it("applies structure rules for OpenRouter verdicts too", () => {
    const r = evaluateRegimeGuard({
      direction: "BUY_CALL",
      verdict: { ...up, source: "openrouter", trend: "chop" },
      openInterest: 200,
      minOpenInterest: 50,
      markIv: 0.55,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/chop/i);
  });
});
