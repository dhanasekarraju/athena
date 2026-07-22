import { describe, expect, it } from "vitest";
import {
  buildEntryLevels,
  contractsToSell,
  decideLongExit,
  decideSignalSell,
  longExitPrice,
  longSlProbe,
  longTpProbe,
} from "./exitLogic.js";

describe("exit quotes", () => {
  it("prefers bid for long exit", () => {
    expect(longExitPrice({ bid: 90, ask: 100, mark: 95 })).toBe(90);
    expect(longExitPrice({ bid: 0, ask: 100, mark: 95 })).toBe(95);
  });

  it("SL probe uses min(bid, mark)", () => {
    expect(longSlProbe({ bid: 80, ask: 100, mark: 95 })).toBe(80);
    expect(longSlProbe({ bid: 0, ask: 100, mark: 95 })).toBe(95);
  });

  it("TP probe requires bid when present", () => {
    expect(longTpProbe({ bid: 120, ask: 130, mark: 125 })).toBe(120);
  });
});

describe("buildEntryLevels", () => {
  it("uses settings TP1 not AI TP2", () => {
    const levels = buildEntryLevels({
      fillPremium: 100,
      slFraction: 0.4,
      tp1Fraction: 0.5,
      aiEntry: 100,
      aiTp1: 150,
      aiTp2: 200,
      aiSl: 60,
    });
    expect(levels.takeProfit1).toBe(150);
    expect(levels.tpSource).toBe("ai_tp1");
    expect(levels.stopLoss).toBe(60); // AI tighter than settings 60? settings=60, ai=60
  });

  it("caps distant AI TP1 near settings", () => {
    const levels = buildEntryLevels({
      fillPremium: 100,
      slFraction: 0.4,
      tp1Fraction: 0.5, // settings TP = 150
      aiTp1: 300, // would wait forever
    });
    expect(levels.takeProfit1).toBeLessThanOrEqual(150 * 1.15);
  });

  it("picks tighter (higher) SL between AI and settings", () => {
    const levels = buildEntryLevels({
      fillPremium: 100,
      slFraction: 0.4, // SL 60
      tp1Fraction: 0.5,
      aiSl: 70, // tighter
    });
    expect(levels.stopLoss).toBe(70);
    expect(levels.slSource).toBe("ai");
  });
});

describe("decideLongExit", () => {
  const base = {
    entryPremium: 100,
    stopLoss: 60,
    takeProfit1: 150,
    settingsTp: 150,
  };

  it("fires SL independently when bid crashes even if mark is high", () => {
    const d = decideLongExit({ bid: 55, ask: 100, mark: 90 }, base);
    expect(d.reason).toBe("stop_loss");
  });

  it("fires TP when bid reaches nearer target", () => {
    const d = decideLongExit(
      { bid: 152, ask: 160, mark: 155 },
      { ...base, takeProfit1: 200, settingsTp: 150 },
    );
    expect(d.reason).toBe("take_profit_1");
    expect(d.effectiveTp).toBe(150);
  });

  it("does not TP on mark alone when bid is below", () => {
    const d = decideLongExit({ bid: 140, ask: 160, mark: 160 }, base);
    expect(d.reason).toBeNull();
  });

  it("arms trail after +10% and exits on small giveback (locks profit)", () => {
    const peak = decideLongExit(
      { bid: 120, ask: 125, mark: 122 },
      { ...base, peakExitPx: 100 },
    );
    expect(peak.reason).toBeNull();
    expect(peak.peakExitPx).toBe(120);

    // peak 120 → trail floor 120*0.93=111.6; minLock 100*1.08=108 → effSl≈111.6
    const drop = decideLongExit(
      { bid: 110, ask: 112, mark: 111 },
      { ...base, peakExitPx: 120 },
    );
    expect(drop.reason).toBe("trail_stop");
    expect(drop.effectiveSl).toBeGreaterThanOrEqual(111);
  });

  it("does not allow trail to collapse to a tiny green exit", () => {
    // Big peak then dump toward entry — must still lock ~+8%, not ₹1 green
    const d = decideLongExit(
      { bid: 102, ask: 104, mark: 103 },
      { ...base, peakExitPx: 159 },
    );
    expect(d.reason).toMatch(/trail_stop|protect_breakeven/);
    expect(d.effectiveSl).toBeGreaterThanOrEqual(100 * 1.08);
  });

  it("SL wins over TP if both would fire", () => {
    const d = decideLongExit(
      { bid: 50, ask: 200, mark: 50 },
      { ...base, stopLoss: 60, takeProfit1: 40 },
    );
    expect(d.reason).toBe("stop_loss");
  });
});

describe("decideSignalSell", () => {
  it("fully exits on strong opposite signal", () => {
    const d = decideSignalSell({
      positionDirection: "BUY_CALL",
      signalDirection: "BUY_PUT",
      confidence: 72,
      minConfidence: 32,
    });
    expect(d.reason).toBe("signal_flip");
    expect(d.fraction).toBe(1);
  });

  it("partially exits on opposite at min confidence", () => {
    const d = decideSignalSell({
      positionDirection: "BUY_PUT",
      signalDirection: "BUY_CALL",
      confidence: 40,
      minConfidence: 32,
    });
    expect(d.reason).toBe("signal_flip_partial");
    expect(d.fraction).toBeGreaterThanOrEqual(0.5);
  });

  it("scales out on HOLD", () => {
    const d = decideSignalSell({
      positionDirection: "BUY_CALL",
      signalDirection: "HOLD",
      confidence: 55,
      minConfidence: 40,
    });
    expect(d.reason).toBe("signal_hold");
    expect(d.fraction).toBe(0.5);
  });

  it("holds when same direction stays strong", () => {
    const d = decideSignalSell({
      positionDirection: "BUY_CALL",
      signalDirection: "BUY_CALL",
      confidence: 60,
      minConfidence: 40,
    });
    expect(d.reason).toBeNull();
    expect(d.fraction).toBe(0);
  });

  it("trims on same-direction fade", () => {
    const d = decideSignalSell({
      positionDirection: "BUY_CALL",
      signalDirection: "BUY_CALL",
      confidence: 20,
      minConfidence: 40,
    });
    expect(d.reason).toBe("signal_fade");
    expect(d.fraction).toBe(0.33);
  });
});

describe("contractsToSell", () => {
  it("rounds down but sells at least 1 when fraction says so", () => {
    expect(contractsToSell(12, 0.5)).toBe(6);
    expect(contractsToSell(12, 1)).toBe(12);
    expect(contractsToSell(1, 0.33)).toBe(0);
    expect(contractsToSell(1, 0.5)).toBe(1);
  });
});
