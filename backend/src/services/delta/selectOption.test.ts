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

  it("prefers slightly ITM / ATM call over far OTM", () => {
    // spot 95000, atr 1000 → target ≈ 94650; allow [94000, 95500]
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
      ticker({
        product_id: 4,
        symbol: "C-BTC-90000-280325",
        strike_price: 90000,
        contract_type: "call_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "500",
        open_interest: 999,
      }),
    ];

    const selected = selectDeltaOption(rows, {
      direction: "BUY_CALL",
      spot: 95000,
      atr: 1000,
      now,
    });
    expect(selected?.productSymbol).toBe("C-BTC-94500-280325");
    expect(selected?.strike).toBe(94500);
  });

  it("prefers slightly ITM put over far OTM", () => {
    // spot 95000, atr 1000 → put target ≈ 95350; allow [94500, 96000]
    const rows: DeltaTicker[] = [
      ticker({
        product_id: 1,
        symbol: "P-BTC-95500-280325",
        strike_price: 95500,
        contract_type: "put_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "200",
        open_interest: 30,
      }),
      ticker({
        product_id: 2,
        symbol: "P-BTC-94000-280325",
        strike_price: 94000,
        contract_type: "put_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "80",
        open_interest: 200,
      }),
    ];

    const selected = selectDeltaOption(rows, {
      direction: "BUY_PUT",
      spot: 95000,
      atr: 1000,
      now,
    });
    expect(selected?.strike).toBe(95500);
  });

  it("returns null for empty chain", () => {
    expect(selectDeltaOption([], { direction: "BUY_PUT", spot: 100, now })).toBeNull();
  });
});
