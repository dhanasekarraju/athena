import { describe, expect, it } from "vitest";
import { selectDeltaOption } from "./selectOption.js";
import type { DeltaTicker } from "./client.js";

function ticker(partial: Partial<DeltaTicker> & { symbol: string; product_id: number }): DeltaTicker {
  return {
    mark_price: "100",
    open_interest: 10,
    ...partial,
  };
}

describe("selectDeltaOption", () => {
  const now = new Date("2025-03-21T08:00:00Z");

  it("prefers slightly ITM call over far OTM (spot 64000 → ~63500 style)", () => {
    // spot 95000, atr 1000 → call target ≈ 94650; allow [94000, 95500]
    const rows: DeltaTicker[] = [
      ticker({
        product_id: 1,
        symbol: "C-BTC-94500-280325",
        strike_price: 94500,
        contract_type: "call_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "220",
        open_interest: 40,
      }),
      ticker({
        product_id: 2,
        symbol: "C-BTC-95500-280325",
        strike_price: 95500,
        contract_type: "call_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "90",
        open_interest: 80,
      }),
      ticker({
        product_id: 3,
        symbol: "C-BTC-100000-280325",
        strike_price: 100000,
        contract_type: "call_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "40",
        open_interest: 500,
      }),
    ];

    const selected = selectDeltaOption(rows, {
      direction: "BUY_CALL",
      spot: 95000,
      atr: 1000,
      now,
    });
    expect(selected?.strike).toBe(94500);
  });

  it("prefers slightly ITM put (spot 1800 → ~1825 style)", () => {
    // spot 1800, atr 50 → put target ≈ 1817.5; allow [1775, 1850]
    const rows: DeltaTicker[] = [
      ticker({
        product_id: 1,
        symbol: "P-ETH-1825-280325",
        strike_price: 1825,
        contract_type: "put_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "40",
        open_interest: 30,
      }),
      ticker({
        product_id: 2,
        symbol: "P-ETH-1750-280325",
        strike_price: 1750,
        contract_type: "put_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "15",
        open_interest: 200,
      }),
      ticker({
        product_id: 3,
        symbol: "P-ETH-1850-280325",
        strike_price: 1850,
        contract_type: "put_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "55",
        open_interest: 20,
      }),
    ];

    const selected = selectDeltaOption(rows, {
      direction: "BUY_PUT",
      spot: 1800,
      atr: 50,
      now,
    });
    expect(selected?.strike).toBe(1825);
  });

  it("returns null for empty chain", () => {
    expect(selectDeltaOption([], { direction: "BUY_PUT", spot: 100, now })).toBeNull();
  });
});
