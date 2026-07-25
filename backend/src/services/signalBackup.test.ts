import { describe, expect, it } from "vitest";
import type { Signal as DbSignal } from "@prisma/client";
import { dbSignalToAiSignal } from "../services/signalBackup.js";

function row(partial: Partial<DbSignal> & Pick<DbSignal, "symbol" | "timeframe" | "direction">): DbSignal {
  return {
    id: "test-id",
    confidence: 40,
    riskLevel: "Medium",
    entryLow: 100,
    entryHigh: 101,
    target1: 110,
    target2: 120,
    stopLoss: 90,
    reasons: ["momentum"],
    factorBreakdown: { rsi: 40 },
    price: 100.5,
    instrumentName: null,
    optionType: null,
    strike: null,
    expiry: null,
    daysToExpiry: null,
    premiumUsd: null,
    premiumCoin: null,
    markIv: null,
    premiumEntryLow: null,
    premiumEntryHigh: null,
    premiumTarget1: null,
    premiumTarget2: null,
    premiumStopLoss: null,
    optionMeta: null,
    createdAt: new Date(),
    ...partial,
  };
}

describe("dbSignalToAiSignal", () => {
  it("maps DB row to AiSignal with stale=true and backup reason", () => {
    const signal = dbSignalToAiSignal(
      row({
        symbol: "BTC",
        timeframe: "5m",
        direction: "BUY_CALL",
      }),
    );
    expect(signal.stale).toBe(true);
    expect(signal.symbol).toBe("BTC");
    expect(signal.direction).toBe("BUY_CALL");
    expect(signal.entry_range).toEqual({ low: 100, high: 101 });
    expect(signal.reasons[0]).toMatch(/Cached backup/i);
    expect(signal.option).toBeNull();
  });

  it("restores option + premium plan when present", () => {
    const signal = dbSignalToAiSignal(
      row({
        symbol: "ETH",
        timeframe: "1m",
        direction: "BUY_PUT",
        instrumentName: "P-ETH-1850-310726",
        optionType: "put",
        strike: 1850,
        expiry: new Date("2026-07-31T08:00:00Z"),
        daysToExpiry: 5,
        premiumUsd: 40,
        premiumCoin: 0.02,
        markIv: 0.5,
        premiumEntryLow: 38,
        premiumEntryHigh: 42,
        premiumTarget1: 60,
        premiumTarget2: 80,
        premiumStopLoss: 24,
        optionMeta: {
          venue: "delta",
          bid_usd: 39,
          ask_usd: 41,
          open_interest: 100,
        },
      }),
    );
    expect(signal.option?.instrument_name).toBe("P-ETH-1850-310726");
    expect(signal.option?.open_interest).toBe(100);
    expect(signal.premium_plan?.target_1).toBe(60);
  });
});
