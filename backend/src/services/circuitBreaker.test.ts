import { describe, expect, it } from "vitest";
import {
  countTrailingStopLosses,
  evaluateCircuitBreaker,
  startOfIstTradingDay,
} from "./circuitBreaker.js";

describe("startOfIstTradingDay", () => {
  it("returns a Date before now", () => {
    const start = startOfIstTradingDay(Date.parse("2026-07-25T10:00:00+05:30"));
    expect(start.getTime()).toBeLessThanOrEqual(Date.parse("2026-07-25T10:00:00+05:30"));
    // 25 Jul 2026 00:00 IST = 24 Jul 2026 18:30 UTC
    expect(start.toISOString()).toBe("2026-07-24T18:30:00.000Z");
  });
});

describe("evaluateCircuitBreaker", () => {
  it("trips on daily loss", () => {
    const r = evaluateCircuitBreaker({
      dayRealizedPnlInr: -2100,
      dailyLossLimitInr: 2000,
      consecutiveStopLosses: 0,
      maxConsecutiveStopLosses: 3,
    });
    expect(r.trip).toBe(true);
    if (r.trip) expect(r.why).toMatch(/daily loss/i);
  });

  it("trips on consecutive SLs", () => {
    const r = evaluateCircuitBreaker({
      dayRealizedPnlInr: -100,
      dailyLossLimitInr: 5000,
      consecutiveStopLosses: 3,
      maxConsecutiveStopLosses: 3,
    });
    expect(r.trip).toBe(true);
    if (r.trip) expect(r.why).toMatch(/consecutive/i);
  });

  it("does not trip when within limits", () => {
    const r = evaluateCircuitBreaker({
      dayRealizedPnlInr: -500,
      dailyLossLimitInr: 2000,
      consecutiveStopLosses: 1,
      maxConsecutiveStopLosses: 3,
    });
    expect(r.trip).toBe(false);
  });
});

describe("countTrailingStopLosses", () => {
  it("counts only trailing stops", () => {
    expect(countTrailingStopLosses(["stop_loss", "stop_loss", "trail_stop"])).toBe(2);
    expect(countTrailingStopLosses(["trail_stop", "stop_loss"])).toBe(0);
  });
});
