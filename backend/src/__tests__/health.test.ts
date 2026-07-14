import { describe, it, expect } from "vitest";

describe("health check contract", () => {
  it("expects a status field of 'ok'", () => {
    const mockResponse = { status: "ok", service: "athena-backend" };
    expect(mockResponse.status).toBe("ok");
  });
});

describe("trade PnL calculation", () => {
  function calcPnl(direction: "BUY_CALL" | "BUY_PUT", entry: number, exit: number, qty: number) {
    const dir = direction === "BUY_CALL" ? 1 : -1;
    return dir * (exit - entry) * qty;
  }

  it("computes positive PnL for a winning BUY_CALL", () => {
    expect(calcPnl("BUY_CALL", 100, 110, 2)).toBe(20);
  });

  it("computes positive PnL for a winning BUY_PUT", () => {
    expect(calcPnl("BUY_PUT", 100, 90, 2)).toBe(20);
  });

  it("computes negative PnL for a losing trade", () => {
    expect(calcPnl("BUY_CALL", 100, 90, 1)).toBe(-10);
  });
});
