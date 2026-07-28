import { describe, expect, it } from "vitest";
import {
  SAME_DIRECTION_COOLDOWN_LOSS_MS,
  SAME_DIRECTION_COOLDOWN_WIN_MS,
  STOP_LOSS_COOLDOWN_MS,
  TIRED_MOVE_AGE_MS,
  TIRED_MOVE_MIN_REASONS,
  evaluateEntryGuards,
  requiredConfidenceForSymbol,
} from "./entryGuards.js";

describe("requiredConfidenceForSymbol", () => {
  it("softens 5m bar: max(35, minConfidence - 5)", () => {
    expect(requiredConfidenceForSymbol("BTC", 40, "5m")).toBe(35);
    expect(requiredConfidenceForSymbol("ETH", 45, "5m")).toBe(40);
    expect(requiredConfidenceForSymbol("BTC", 32, "5m")).toBe(35);
  });

  it("floors 15m+ at max(minConfidence, 45) when allowed", () => {
    expect(requiredConfidenceForSymbol("BTC", 32, "15m")).toBe(45);
    expect(requiredConfidenceForSymbol("ETH", 45, "15m")).toBe(45);
    expect(requiredConfidenceForSymbol("BTC", 48, "15m")).toBe(48);
  });
});

describe("evaluateEntryGuards", () => {
  const base = {
    symbol: "BTC",
    direction: "BUY_CALL",
    confidence: 40,
    riskLevel: "High",
    timeframe: "5m",
    minConfidence: 40,
    skipHighRisk: false,
  };

  it("blocks 1m on live exam desk (allowOneMinuteEntry false/undefined)", () => {
    const r = evaluateEntryGuards({ ...base, timeframe: "1m", confidence: 80 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/1m blocked/i);
  });

  it("blocks 15m on live exam desk — too late for options", () => {
    const r = evaluateEntryGuards({
      ...base,
      timeframe: "15m",
      confidence: 80,
      minConfidence: 40,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/15m blocked/i);
  });

  it("allows 15m when paper allowSlowTimeframeEntry", () => {
    const r = evaluateEntryGuards({
      ...base,
      timeframe: "15m",
      confidence: 45,
      minConfidence: 40,
      allowSlowTimeframeEntry: true,
      riskLevel: "Medium",
    });
    expect(r.ok).toBe(true);
  });

  it("allows 1m when paper/exam override allowOneMinuteEntry", () => {
    const r = evaluateEntryGuards({
      ...base,
      timeframe: "1m",
      confidence: 80,
      allowOneMinuteEntry: true,
    });
    expect(r.ok).toBe(true);
  });

  it("allows 5m at softened bar (Settings 40 → need 35)", () => {
    const r = evaluateEntryGuards({
      ...base,
      timeframe: "5m",
      minConfidence: 40,
      confidence: 35,
      riskLevel: "Medium",
    });
    expect(r.ok).toBe(true);
    expect(r.requiredConfidence).toBe(35);
  });

  it("blocks 5m below softened bar", () => {
    const r = evaluateEntryGuards({
      ...base,
      timeframe: "5m",
      minConfidence: 40,
      confidence: 34,
    });
    expect(r.ok).toBe(false);
    expect(r.requiredConfidence).toBe(35);
  });

  it("allows 5m when conf meets Settings-softened bar", () => {
    const r = evaluateEntryGuards(base);
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

  it("allows High risk when skipHighRisk is off", () => {
    const r = evaluateEntryGuards({
      ...base,
      confidence: 35,
      riskLevel: "High",
      skipHighRisk: false,
    });
    expect(r.ok).toBe(true);
  });

  it("enforces stop-loss cooldown on same-direction re-entry", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      direction: "BUY_CALL",
      lastStopLossAt: new Date(now - 2 * 60 * 1000).toISOString(),
      nowMs: now,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cooldown/i);
  });

  it("allows opposite direction when only same-dir SL cooldown would apply (caller omits lastStopLossAt)", () => {
    // autoTrader only passes lastStopLossAt for matching direction — PUT after CALL SL
    // arrives with lastStopLossAt=null and should pass.
    const r = evaluateEntryGuards({
      ...base,
      direction: "BUY_PUT",
      lastStopLossAt: null,
      confidence: 35,
    });
    expect(r.ok).toBe(true);
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

  it("blocks same-direction re-entry within 5m after a win", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      direction: "BUY_PUT",
      lastSameDirectionCloseAt: new Date(now - 2 * 60 * 1000).toISOString(),
      lastSameDirectionExitReason: "trail_stop",
      nowMs: now,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/same-direction cooldown/i);
  });

  it("blocks same-direction re-entry within 5m after stop_loss", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      direction: "BUY_PUT",
      lastSameDirectionCloseAt: new Date(now - 2 * 60 * 1000).toISOString(),
      lastSameDirectionExitReason: "stop_loss",
      nowMs: now,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/same-direction cooldown/i);
  });

  it("allows same-direction re-entry after 5m win cooldown", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      lastSameDirectionCloseAt: new Date(now - SAME_DIRECTION_COOLDOWN_WIN_MS - 1000).toISOString(),
      lastSameDirectionExitReason: "trail_stop",
      nowMs: now,
    });
    expect(r.ok).toBe(true);
  });

  it("allows same-direction re-entry after 5m loss cooldown", () => {
    const now = Date.now();
    const r = evaluateEntryGuards({
      ...base,
      lastSameDirectionCloseAt: new Date(now - SAME_DIRECTION_COOLDOWN_LOSS_MS - 1000).toISOString(),
      lastSameDirectionExitReason: "stop_loss",
      nowMs: now,
    });
    expect(r.ok).toBe(true);
  });

  it("allows extended moves when reasons are strong enough", () => {
    const r = evaluateEntryGuards({
      ...base,
      directionAgeMs: 121 * 60 * 1000,
      reasonCount: TIRED_MOVE_MIN_REASONS,
    });
    expect(r.ok).toBe(true);
  });

  it("blocks weak reasons on a tired move", () => {
    const r = evaluateEntryGuards({
      ...base,
      directionAgeMs: TIRED_MOVE_AGE_MS + 60_000,
      reasonCount: 2,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/weak signal on tired move/i);
  });

  it("allows tired move when enough reasons confirm", () => {
    const r = evaluateEntryGuards({
      ...base,
      directionAgeMs: TIRED_MOVE_AGE_MS + 60_000,
      reasonCount: TIRED_MOVE_MIN_REASONS,
    });
    expect(r.ok).toBe(true);
  });
});
