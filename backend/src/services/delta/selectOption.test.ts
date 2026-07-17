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

  it("prefers ~1 ATR OTM call inside DTE band", () => {
    const rows: DeltaTicker[] = [
      ticker({
        product_id: 1,
        symbol: "C-BTC-96000-280325",
        strike_price: 96000,
        contract_type: "call_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "120",
        open_interest: 50,
      }),
      ticker({
        product_id: 2,
        symbol: "C-BTC-100000-280325",
        strike_price: 100000,
        contract_type: "call_options",
        expiry_time: Date.parse("2025-03-28T08:00:00Z"),
        mark_price: "40",
        open_interest: 500,
      }),
      ticker({
        product_id: 3,
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
    expect(selected?.productSymbol).toBe("C-BTC-96000-280325");
    expect(selected?.strike).toBe(96000);
  });

  it("returns null for empty chain", () => {
    expect(selectDeltaOption([], { direction: "BUY_PUT", spot: 100, now })).toBeNull();
  });
});
