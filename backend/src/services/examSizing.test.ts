import { describe, expect, it } from "vitest";
import { EXAM_RISK_PCT_OF_EQUITY } from "./examDesk.js";
import { EXAM_MICRO_MAX_SINGLE_PCT, sizeExamContracts } from "./examSizing.js";

describe("sizeExamContracts", () => {
  it("sizes multiple lots under risk + cash when affordable", () => {
    // equity 10000 → risk 8500; cashBudget min(5000,5000,9500)=5000; cost 100 → size 50
    const r = sizeExamContracts({
      maxOrderInr: 5000,
      exposureRoomInr: 5000,
      walletInr: 10000,
      equityInr: 10000,
      costPerContractInr: 100,
    });
    expect(r.size).toBe(50);
    expect(r.microAllowOne).toBe(false);
    expect(r.riskBudget).toBeCloseTo(10000 * EXAM_RISK_PCT_OF_EQUITY);
  });

  it("micro allow-one when risk cannot afford 1 lot but cash + micro pct can", () => {
    // equity 500 → risk 425 (85%); cost 80 → preferred sizes normally
    // tighter case: equity 200, risk 170, cost 180 → allow-one if cash ok and ≤95%
    const r = sizeExamContracts({
      maxOrderInr: 1000,
      exposureRoomInr: 2000,
      walletInr: 500,
      equityInr: 200,
      costPerContractInr: 180,
    });
    expect(r.size).toBe(1);
    expect(r.microAllowOne).toBe(true);
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

  it("refuses when 1 lot exceeds micro equity pct even if cash allows", () => {
    const r = sizeExamContracts({
      maxOrderInr: 1000,
      exposureRoomInr: 2000,
      walletInr: 1000,
      equityInr: 100,
      costPerContractInr: 99,
      microMaxSinglePct: 0.5,
    });
    expect(r.size).toBe(0);
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
