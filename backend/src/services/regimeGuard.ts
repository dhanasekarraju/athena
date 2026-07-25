/**
 * Paper 3 — Market Structure + Open Interest + Volatility (hybrid entry permission).
 * Pure: never places orders; only allows/denies.
 */

import type { TrendVerdict } from "./trendJudge.js";
import { isTrendJudgeLive } from "./trendJudge.js";

export interface RegimeGuardInput {
  direction: "BUY_CALL" | "BUY_PUT";
  verdict: TrendVerdict;
  openInterest: number;
  minOpenInterest: number;
  /** Annualized IV as decimal if known (e.g. 0.55 = 55%). */
  markIv?: number | null;
  /** Reject buyer entries when IV is this rich (default 0.95). */
  maxMarkIv?: number;
  /** Minimum LLM trend strength when judge is live (default 55). */
  minTrendStrength?: number;
}

export interface RegimeGuardResult {
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Permission to open a long premium ticket.
 * Structure (trend) + OI + vol must not fight the trade.
 */
export function evaluateRegimeGuard(input: RegimeGuardInput): RegimeGuardResult {
  const minStrength = input.minTrendStrength ?? 55;
  const maxIv = input.maxMarkIv ?? 0.95;

  if (isTrendJudgeLive(input.verdict.source)) {
    if (input.verdict.trend === "chop") {
      return {
        ok: false,
        reason: "regime: chop structure — no premium buy",
        details: { trend: "chop", strength: input.verdict.strength },
      };
    }
    const wantsUp = input.direction === "BUY_CALL";
    const agrees =
      (wantsUp && input.verdict.trend === "up") || (!wantsUp && input.verdict.trend === "down");
    if (!agrees) {
      return {
        ok: false,
        reason: `regime: structure ${input.verdict.trend} fights ${input.direction}`,
        details: { trend: input.verdict.trend, direction: input.direction },
      };
    }
    if (input.verdict.strength < minStrength) {
      return {
        ok: false,
        reason: `regime: weak structure (${input.verdict.strength} < ${minStrength})`,
        details: { strength: input.verdict.strength, minStrength },
      };
    }
    const frames = input.verdict.frames ?? [];
    const hasSlow = frames.includes("5m") || frames.includes("15m");
    if (frames.length > 0 && !hasSlow) {
      return {
        ok: false,
        reason: "regime: need 5m or 15m structure frame",
        details: { frames },
      };
    }
  }

  if (input.minOpenInterest > 0 && input.openInterest < input.minOpenInterest) {
    return {
      ok: false,
      reason: `regime: OI ${input.openInterest} < min ${input.minOpenInterest}`,
      details: { openInterest: input.openInterest, minOpenInterest: input.minOpenInterest },
    };
  }

  const iv = input.markIv;
  if (iv != null && Number.isFinite(iv) && iv > 0 && iv > maxIv) {
    return {
      ok: false,
      reason: `regime: IV too rich for buyer (${(iv * 100).toFixed(0)}% > ${(maxIv * 100).toFixed(0)}%)`,
      details: { markIv: iv, maxMarkIv: maxIv },
    };
  }

  return { ok: true };
}
