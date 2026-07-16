/**
 * Soft entry filters for AutoTrader.
 * Confidence / High-risk stay fully under BotConfig (Settings UI) — options
 * signals often sit near ~32 and High risk is normal, so we do not hard-floor those.
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
  requiredConfidence: number;
  details?: Record<string, unknown>;
}

/** Skip ultra-noisy 1m signals for auto-entry. */
export const BLOCKED_ENTRY_TIMEFRAMES = new Set(["1m", "1min", "1"]);

/**
 * Wait after a stop-loss before re-entering the same underlying.
 * 15m: short enough for crypto minute-moves, long enough to avoid instant revenge re-entries.
 */
export const STOP_LOSS_COOLDOWN_MS = 15 * 60 * 1000;

export function requiredConfidenceForSymbol(_symbol: string, minConfidence: number): number {
  return minConfidence;
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

  if (input.skipHighRisk && input.riskLevel === "High") {
    return {
      ok: false,
      reason: "High risk filter",
      requiredConfidence: required,
      details: {
        risk_level: input.riskLevel,
        skipHighRisk: input.skipHighRisk,
      },
    };
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
