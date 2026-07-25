import { describe, expect, it } from "vitest";
import { evaluateLiquidityGuard } from "./liquidityGuard.js";

describe("evaluateLiquidityGuard", () => {
  it("passes tight spread and enough OI", () => {
    const r = evaluateLiquidityGuard({
      bid: 100,
      ask: 102,
      mark: 101,
      openInterest: 50,
      maxSpreadPct: 0.08,
      minOpenInterest: 10,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks wide spread", () => {
    const r = evaluateLiquidityGuard({
      bid: 100,
      ask: 120,
      mark: 110,
      openInterest: 100,
      maxSpreadPct: 0.08,
      minOpenInterest: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/spread/i);
  });

  it("blocks thin OI", () => {
    const r = evaluateLiquidityGuard({
      bid: 100,
      ask: 101,
      mark: 100.5,
      openInterest: 2,
      maxSpreadPct: 0.08,
      minOpenInterest: 10,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/open interest/i);
  });
});
