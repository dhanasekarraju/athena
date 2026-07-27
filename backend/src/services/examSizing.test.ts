import { describe, expect, it } from "vitest";
import { EXAM_RISK_PCT_OF_EQUITY } from "./examDesk.js";
import { EXAM_MICRO_MAX_SINGLE_PCT, sizeExamContracts } from "./examSizing.js";

describe("sizeExamContracts", () => {
  it("sizes multiple lots under 12% risk when affordable", () => {
    // equity 10000 → risk 1200; cost 100 → size 12
    const r = sizeExamContracts({
      maxOrderInr: 5000,
      exposureRoomInr: 5000,
      walletInr: 10000,
      equityInr: 10000,
      costPerContractInr: 100,
    });
    expect(r.size).toBe(12);
    expect(r.microAllowOne).toBe(false);
    expect(r.riskBudget).toBeCloseTo(10000 * EXAM_RISK_PCT_OF_EQUITY);
  });

  it("micro allow-one when 12% cannot afford 1 lot but cash + 35% equity can", () => {
    // equity 500 → risk 60; ETH lot 80; cash plenty
    const r = sizeExamContracts({
      maxOrderInr: 1000,
      exposureRoomInr: 2000,
      walletInr: 500,
      equityInr: 500,
      costPerContractInr: 80,
    });
    expect(r.size).toBe(1);
    expect(r.microAllowOne).toBe(true);
    expect(80).toBeLessThanOrEqual(500 * EXAM_MICRO_MAX_SINGLE_PCT);
  });

  it("refuses when 1 lot exceeds cash budget", () => {
    const r = sizeExamContracts({
      maxOrderInr: 1000,
      exposureRoomInr: 2000,
      walletInr: 50,
      equityInr: 50,
      costPerContractInr: 80,
    });
    expect(r.size).toBe(0);
    expect(r.reason).toMatch(/cash budget/i);
  });

  it("refuses when 1 lot exceeds 35% equity even if cash allows", () => {
    // equity 200 → 35% = 70; cost 100; wallet 1000
    const r = sizeExamContracts({
      maxOrderInr: 1000,
      exposureRoomInr: 2000,
      walletInr: 1000,
      equityInr: 200,
      costPerContractInr: 100,
    });
    expect(r.size).toBe(0);
    expect(r.reason).toMatch(/35% equity|equity/i);
  });

  it("respects maxOrder and exposure room for preferred sizing", () => {
    const r = sizeExamContracts({
      maxOrderInr: 200,
      exposureRoomInr: 5000,
      walletInr: 10000,
      equityInr: 10000,
      costPerContractInr: 50,
    });
    // risk 1200 but maxOrder 200 → preferred 200 → size 4
    expect(r.size).toBe(4);
  });
});
