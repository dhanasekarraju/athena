import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_MIN_CONFIDENCE,
  ETH_ABSOLUTE_MIN_CONFIDENCE,
  HIGH_RISK_MIN_CONFIDENCE,
  STOP_LOSS_COOLDOWN_MS,
  evaluateEntryGuards,
  requiredConfidenceForSymbol,
} from "./entryGuards.js";

describe("requiredConfidenceForSymbol", () => {
  it("applies absolute floor for BTC", () => {
    expect(requiredConfidenceForSymbol("BTC", 32)).toBe(ABSOLUTE_MIN_CONFIDENCE);
  });

  it("keeps higher user minConfidence for BTC", () => {
    expect(requiredConfidenceForSymbol("BTC", 55)).toBe(55);
  });

  it("demands higher bar for ETH", () => {
    // soft floor 40 + 15 extra = 55 (also >= ETH absolute 50)
    expect(requiredConfidenceForSymbol("ETH", 32)).toBe(55);
    expect(requiredConfidenceForSymbol("ETH", 45)).toBe(60);
    expect(requiredConfidenceForSymbol("ETH", 32)).toBeGreaterThanOrEqual(
      ETH_ABSOLUTE_MIN_CONFIDENCE,
    );
  });
});

describe("evaluateEntryGuards", () => {
  const base = {
    symbol: "BTC",
    direction: "BUY_CALL",
    confidence: 55,
    riskLevel: "Medium",
    timeframe: "15m",
    minConfidence: 32,
    skipHighRisk: false,
  };

  it("blocks 1m timeframe", () => {
    const r = evaluateEntryGuards({ ...base, timeframe: "1m", confidence: 80 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timeframe/i);
  });

  it("blocks low confidence even when Settings allow 32", () => {
    const r = evaluateEntryGuards({ ...base, confidence: 32 });
    expect(r.ok).toBe(false);
    expect(r.requiredConfidence).toBe(ABSOLUTE_MIN_CONFIDENCE);
  });

  it("blocks High risk below strong-conviction floor", () => {
    const r = evaluateEntryGuards({
      ...base,
      confidence: 50,
      riskLevel: "High",
      skipHighRisk: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/High risk/i);
  });

  it("allows High risk when conviction is strong and skipHighRisk is off", () => {
    const r = evaluateEntryGuards({
      ...base,
      confidence: HIGH_RISK_MIN_CONFIDENCE,
      riskLevel: "High",
      skipHighRisk: false,
    });
    expect(r.ok).toBe(true);
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

  it("blocks ETH below ETH floor", () => {
    const r = evaluateEntryGuards({
      ...base,
      symbol: "ETH",
      confidence: 45,
      riskLevel: "Medium",
    });
    expect(r.ok).toBe(false);
    expect(r.requiredConfidence).toBe(55);
  });

  it("enforces stop-loss cooldown", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      confidence: 70,
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
      confidence: 70,
      lastStopLossAt: new Date(now - STOP_LOSS_COOLDOWN_MS - 1000).toISOString(),
      nowMs: now,
    });
    expect(r.ok).toBe(true);
  });
});
