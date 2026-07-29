import { describe, expect, it } from "vitest";
import {
  SAME_DIRECTION_COOLDOWN_LOSS_MS,
  STOP_LOSS_COOLDOWN_MS,
  evaluateEntryGuards,
  requiredConfidenceForSymbol,
} from "./entryGuards.js";

describe("requiredConfidenceForSymbol (newborn)", () => {
  it("uses Settings minConfidence for all TFs", () => {
    expect(requiredConfidenceForSymbol("BTC", 32, "1m")).toBe(32);
    expect(requiredConfidenceForSymbol("ETH", 32, "5m")).toBe(32);
    expect(requiredConfidenceForSymbol("BTC", 32, "15m")).toBe(32);
  });
});

describe("evaluateEntryGuards (free mode)", () => {
  const base = {
    symbol: "BTC",
    direction: "BUY_CALL",
    confidence: 32,
    riskLevel: "High",
    timeframe: "1m",
    minConfidence: 32,
    skipHighRisk: false,
  };

  it("allows 1m / 5m / 15m when conf meets Settings", () => {
    expect(evaluateEntryGuards({ ...base, timeframe: "1m" }).ok).toBe(true);
    expect(evaluateEntryGuards({ ...base, timeframe: "5m" }).ok).toBe(true);
    expect(evaluateEntryGuards({ ...base, timeframe: "15m" }).ok).toBe(true);
  });

  it("allows below Settings minConfidence", () => {
    expect(evaluateEntryGuards({ ...base, confidence: 1 }).ok).toBe(true);
  });

  it("allows High risk even when the old filter is enabled", () => {
    expect(
      evaluateEntryGuards({ ...base, confidence: 80, riskLevel: "High", skipHighRisk: true }).ok,
    ).toBe(true);
  });

  it("allows High risk when skipHighRisk is off", () => {
    expect(evaluateEntryGuards(base).ok).toBe(true);
  });

  it("has no stop-loss cooldown", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      lastStopLossAt: new Date(now).toISOString(),
      nowMs: now,
    });
    expect(r.ok).toBe(true);
    expect(STOP_LOSS_COOLDOWN_MS).toBe(0);
  });

  it("allows after short cooldown", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      lastStopLossAt: new Date(now - STOP_LOSS_COOLDOWN_MS - 1000).toISOString(),
      nowMs: now,
    });
    expect(r.ok).toBe(true);
  });

  it("has no same-direction cooldown", () => {
    const now = Date.now();
    expect(
      evaluateEntryGuards({
        ...base,
        lastSameDirectionCloseAt: new Date(now).toISOString(),
        nowMs: now,
      }).ok,
    ).toBe(true);
    expect(SAME_DIRECTION_COOLDOWN_LOSS_MS).toBe(0);
  });
});
