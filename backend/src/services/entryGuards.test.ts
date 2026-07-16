import { describe, expect, it } from "vitest";
import {
  STOP_LOSS_COOLDOWN_MS,
  evaluateEntryGuards,
  requiredConfidenceForSymbol,
} from "./entryGuards.js";

describe("requiredConfidenceForSymbol", () => {
  it("uses Settings minConfidence as-is for BTC and ETH", () => {
    expect(requiredConfidenceForSymbol("BTC", 32)).toBe(32);
    expect(requiredConfidenceForSymbol("ETH", 32)).toBe(32);
    expect(requiredConfidenceForSymbol("ETH", 45)).toBe(45);
  });
});

describe("evaluateEntryGuards", () => {
  const base = {
    symbol: "BTC",
    direction: "BUY_CALL",
    confidence: 32,
    riskLevel: "High",
    timeframe: "15m",
    minConfidence: 32,
    skipHighRisk: false,
  };

  it("blocks 1m timeframe", () => {
    const r = evaluateEntryGuards({ ...base, timeframe: "1m", confidence: 80 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timeframe/i);
  });

  it("allows typical 32 / High risk when Settings allow it", () => {
    const r = evaluateEntryGuards(base);
    expect(r.ok).toBe(true);
  });

  it("blocks below Settings minConfidence", () => {
    const r = evaluateEntryGuards({ ...base, confidence: 31 });
    expect(r.ok).toBe(false);
  });

  it("honors skipHighRisk when enabled", () => {
    const r = evaluateEntryGuards({
      ...base,
      confidence: 80,
      riskLevel: "High",
      skipHighRisk: true,
    });
    expect(r.ok).toBe(false);
  });

  it("allows High risk when skipHighRisk is off", () => {
    const r = evaluateEntryGuards({
      ...base,
      confidence: 32,
      riskLevel: "High",
      skipHighRisk: false,
    });
    expect(r.ok).toBe(true);
  });

  it("enforces stop-loss cooldown", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      lastStopLossAt: new Date(now - 10 * 60 * 1000).toISOString(),
      nowMs: now,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cooldown/i);
  });

  it("allows entry after cooldown expires", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      lastStopLossAt: new Date(now - STOP_LOSS_COOLDOWN_MS - 1000).toISOString(),
      nowMs: now,
    });
    expect(r.ok).toBe(true);
  });
});
