import { describe, expect, it } from "vitest";

// trendJudge imports env.ts which validates required vars at load time.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret-test-secret";
process.env.JWT_REFRESH_SECRET ??= "test-secret-test-secret";

const { parseVerdict, verdictAllows } = await import("./trendJudge.js");
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
});
