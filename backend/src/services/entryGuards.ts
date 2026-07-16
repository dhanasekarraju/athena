/**
 * Hard entry filters for AutoTrader.
 * These sit on top of BotConfig so a loose Settings UI (low minConfidence,
 * skipHighRisk off) cannot re-open the noisy entries that caused most stop-outs.
 */

export interface EntryGuardInput {
  symbol: string;
  direction: string;
  confidence: number;
  riskLevel: string;
  timeframe?: string | null;
  minConfidence: number;
  skipHighRisk: boolean;
  /** ISO timestamp of last stop_loss close on this underlying, if any */
  lastStopLossAt?: string | null;
  nowMs?: number;
}

export interface EntryGuardResult {
  ok: boolean;
  reason?: string;
  /** Effective confidence floor used for this symbol */
  requiredConfidence: number;
  details?: Record<string, unknown>;
}

/** Soft floor so Settings minConfidence=32 cannot enter noise. */
export const ABSOLUTE_MIN_CONFIDENCE = 40;

/** ETH has been the bleed — demand a higher bar than BTC. */
export const ETH_EXTRA_CONFIDENCE = 15;
export const ETH_ABSOLUTE_MIN_CONFIDENCE = 50;

/** High-risk entries only allowed when conviction is strong. */
export const HIGH_RISK_MIN_CONFIDENCE = 55;

/** Skip ultra-noisy 1m signals for auto-entry. */
export const BLOCKED_ENTRY_TIMEFRAMES = new Set(["1m", "1min", "1"]);

/** Minutes to wait after a stop-loss before re-entering the same underlying. */
export const STOP_LOSS_COOLDOWN_MS = 45 * 60 * 1000;

export function requiredConfidenceForSymbol(symbol: string, minConfidence: number): number {
  const sym = symbol.toUpperCase();
  const base = Math.max(minConfidence, ABSOLUTE_MIN_CONFIDENCE);
  if (sym === "ETH") {
    return Math.max(base + ETH_EXTRA_CONFIDENCE, ETH_ABSOLUTE_MIN_CONFIDENCE, minConfidence + ETH_EXTRA_CONFIDENCE);
  }
  return base;
}

export function evaluateEntryGuards(input: EntryGuardInput): EntryGuardResult {
  const sym = input.symbol.toUpperCase();
  const required = requiredConfidenceForSymbol(sym, input.minConfidence);
  const tf = (input.timeframe ?? "").toLowerCase().trim();
  const now = input.nowMs ?? Date.now();

  if (tf && BLOCKED_ENTRY_TIMEFRAMES.has(tf)) {
    return {
      ok: false,
      reason: `timeframe ${input.timeframe} blocked for auto-entry`,
      requiredConfidence: required,
      details: { timeframe: input.timeframe },
    };
  }

  if (input.confidence < required) {
    return {
      ok: false,
      reason: `confidence ${input.confidence} < required ${required}`,
      requiredConfidence: required,
      details: {
        confidence: input.confidence,
        minConfidence: input.minConfidence,
        requiredConfidence: required,
      },
    };
  }

  const isHigh = input.riskLevel === "High";
  if (isHigh) {
    // Even when skipHighRisk is off, High risk needs strong conviction.
    if (input.skipHighRisk || input.confidence < HIGH_RISK_MIN_CONFIDENCE) {
      return {
        ok: false,
        reason: input.skipHighRisk
          ? "High risk filter"
          : `High risk needs confidence >= ${HIGH_RISK_MIN_CONFIDENCE}`,
        requiredConfidence: required,
        details: {
          risk_level: input.riskLevel,
          confidence: input.confidence,
          highRiskMin: HIGH_RISK_MIN_CONFIDENCE,
          skipHighRisk: input.skipHighRisk,
        },
      };
    }
  }

  if (input.lastStopLossAt) {
    const last = Date.parse(input.lastStopLossAt);
    if (Number.isFinite(last) && now - last < STOP_LOSS_COOLDOWN_MS) {
      const remainMin = Math.ceil((STOP_LOSS_COOLDOWN_MS - (now - last)) / 60000);
      return {
        ok: false,
        reason: `stop-loss cooldown (${remainMin}m left)`,
        requiredConfidence: required,
        details: {
          lastStopLossAt: input.lastStopLossAt,
          cooldownMs: STOP_LOSS_COOLDOWN_MS,
          remainMin,
        },
      };
    }
  }

  return { ok: true, requiredConfidence: required };
}
