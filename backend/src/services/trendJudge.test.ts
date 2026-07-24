import { describe, expect, it } from "vitest";

// trendJudge imports env.ts which validates required vars at load time.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-test-secret";
process.env.JWT_REFRESH_SECRET ??= "test-secret-test-secret";

const {
  parseVerdict,
  verdictAllows,
  shouldMomentumExit,
  MOMENTUM_EXIT_MIN_STRENGTH,
} = await import("./trendJudge.js");
type TrendVerdict = import("./trendJudge.js").TrendVerdict;

describe("parseVerdict", () => {
  it("parses a clean JSON reply", () => {
    const v = parseVerdict('{"trend":"up","strength":72,"reason":"higher highs on 1h and 4h"}');
    expect(v).not.toBeNull();
    expect(v!.trend).toBe("up");
    expect(v!.strength).toBe(72);
    expect(v!.source).toBe("gemini");
  });

  it("parses replies wrapped in markdown fences", () => {
    const v = parseVerdict('```json\n{"trend":"chop","strength":60,"reason":"sideways"}\n```');
    expect(v).not.toBeNull();
    expect(v!.trend).toBe("chop");
  });

  it("clamps strength into 0-100", () => {
    const v = parseVerdict('{"trend":"down","strength":250,"reason":"x"}');
    expect(v!.strength).toBe(100);
  });

  it("rejects unknown trend values", () => {
    expect(parseVerdict('{"trend":"sideways","strength":50,"reason":"x"}')).toBeNull();
  });

  it("rejects non-JSON garbage", () => {
    expect(parseVerdict("the trend is up, probably")).toBeNull();
  });
});

describe("verdictAllows", () => {
  const verdict = (trend: TrendVerdict["trend"], source: TrendVerdict["source"] = "gemini") =>
    ({ trend, strength: 70, reason: "test", source }) satisfies TrendVerdict;

  it("allows call in an uptrend and put in a downtrend", () => {
    expect(verdictAllows("BUY_CALL", verdict("up")).ok).toBe(true);
    expect(verdictAllows("BUY_PUT", verdict("down")).ok).toBe(true);
  });

  it("blocks entries against the trend", () => {
    expect(verdictAllows("BUY_CALL", verdict("down")).ok).toBe(false);
    expect(verdictAllows("BUY_PUT", verdict("up")).ok).toBe(false);
  });

  it("blocks everything in chop", () => {
    expect(verdictAllows("BUY_CALL", verdict("chop")).ok).toBe(false);
    expect(verdictAllows("BUY_PUT", verdict("chop")).ok).toBe(false);
  });

  it("fails open when the judge is unavailable", () => {
    expect(verdictAllows("BUY_CALL", verdict("chop", "unavailable")).ok).toBe(true);
    expect(verdictAllows("BUY_PUT", verdict("chop", "unavailable")).ok).toBe(true);
  });

  it("allows when 1m+5m agree even without 15m", () => {
    const v: TrendVerdict = {
      trend: "up",
      strength: 70,
      reason: "1m+5m up, 15m flat",
      source: "gemini",
      frames: ["1m", "5m"],
    };
    expect(verdictAllows("BUY_CALL", v).ok).toBe(true);
  });

  it("blocks when only 15m agrees (15m lags)", () => {
    const v: TrendVerdict = {
      trend: "up",
      strength: 60,
      reason: "15m up only",
      source: "gemini",
      frames: ["15m"],
    };
    expect(verdictAllows("BUY_CALL", v).ok).toBe(false);
  });

  it("for flip-after-SL requires 1m+5m core momentum", () => {
    const weak: TrendVerdict = {
      trend: "down",
      strength: 55,
      reason: "5m down only",
      source: "gemini",
      frames: ["5m"],
    };
    expect(verdictAllows("BUY_PUT", weak, { requireCoreFrames: true }).ok).toBe(false);

    const core: TrendVerdict = {
      trend: "down",
      strength: 70,
      frames: ["1m", "5m"],
      reason: "1m+5m down, 15m flat",
      source: "gemini",
    };
    expect(verdictAllows("BUY_PUT", core, { requireCoreFrames: true }).ok).toBe(true);
  });

  it("parses frames from Gemini JSON", () => {
    const v = parseVerdict(
      '{"trend":"down","strength":80,"frames":["1m","5m","15m"],"reason":"all down"}',
    );
    expect(v!.frames).toEqual(["1m", "5m", "15m"]);
  });
});

describe("shouldMomentumExit", () => {
  const opened = Date.now() - 5 * 60 * 1000;
  const adverseDown: TrendVerdict = {
    trend: "down",
    strength: 75,
    reason: "1m+5m down",
    source: "gemini",
    frames: ["1m", "5m"],
  };

  it("exits CALL when 1m+5m turn down and not meaningfully green", () => {
    const r = shouldMomentumExit({
      positionDirection: "BUY_CALL",
      verdict: adverseDown,
      entryPremium: 100,
      exitPx: 95,
      openedAtMs: opened,
    });
    expect(r.exit).toBe(true);
  });

  it("does not exit during grace period", () => {
    const r = shouldMomentumExit({
      positionDirection: "BUY_CALL",
      verdict: adverseDown,
      entryPremium: 100,
      exitPx: 95,
      openedAtMs: Date.now() - 60_000,
    });
    expect(r.exit).toBe(false);
    expect(r.why).toMatch(/grace/i);
  });

  it("does not exit winners already +3% — leave to trail", () => {
    const r = shouldMomentumExit({
      positionDirection: "BUY_CALL",
      verdict: adverseDown,
      entryPremium: 100,
      exitPx: 104,
      openedAtMs: opened,
    });
    expect(r.exit).toBe(false);
    expect(r.why).toMatch(/trail/i);
  });

  it("does not exit on chop or unavailable (fail-closed)", () => {
    expect(
      shouldMomentumExit({
        positionDirection: "BUY_CALL",
        verdict: { ...adverseDown, trend: "chop" },
        entryPremium: 100,
        exitPx: 95,
        openedAtMs: opened,
      }).exit,
    ).toBe(false);
    expect(
      shouldMomentumExit({
        positionDirection: "BUY_CALL",
        verdict: { ...adverseDown, source: "unavailable" },
        entryPremium: 100,
        exitPx: 95,
        openedAtMs: opened,
      }).exit,
    ).toBe(false);
  });

  it("does not exit on weak adverse strength", () => {
    const r = shouldMomentumExit({
      positionDirection: "BUY_CALL",
      verdict: { ...adverseDown, strength: MOMENTUM_EXIT_MIN_STRENGTH - 1 },
      entryPremium: 100,
      exitPx: 95,
      openedAtMs: opened,
    });
    expect(r.exit).toBe(false);
  });

  it("exits PUT when 1m+5m turn up", () => {
    const r = shouldMomentumExit({
      positionDirection: "BUY_PUT",
      verdict: {
        trend: "up",
        strength: 80,
        reason: "1m+5m up",
        source: "gemini",
        frames: ["1m", "5m"],
      },
      entryPremium: 100,
      exitPx: 97,
      openedAtMs: opened,
    });
    expect(r.exit).toBe(true);
  });
});
