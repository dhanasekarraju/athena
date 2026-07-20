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
  /** ISO timestamp of last close in the same direction (any exit reason) */
  lastSameDirectionCloseAt?: string | null;
  /** Exit reason for that close — loss exits wait longer (options move fast). */
  lastSameDirectionExitReason?: string | null;
  /** Ms since this direction first appeared at entry-grade confidence */
  directionAgeMs?: number | null;
  /** Count of AI reason strings on the live signal */
  reasonCount?: number;
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
 * Blocks revenge re-entries across different strikes of BTC/ETH.
 * 25m with minConfidence ≥40: enough to break a losing streak, not half a session idle.
 */
export const STOP_LOSS_COOLDOWN_MS = 25 * 60 * 1000;

/** Do not enter a move that has already been running this long at min confidence. */
export const MAX_DIRECTION_AGE_MS = 90 * 60 * 1000;

/** After a win/trail/BE on this direction — brief pause, don't double-tap. */
export const SAME_DIRECTION_COOLDOWN_WIN_MS = 20 * 60 * 1000;

/** After stop_loss on this direction — longer pause before same-side re-entry. */
export const SAME_DIRECTION_COOLDOWN_LOSS_MS = 45 * 60 * 1000;

/** @deprecated use sameDirectionCooldownMs() */
export const SAME_DIRECTION_COOLDOWN_MS = SAME_DIRECTION_COOLDOWN_LOSS_MS;

export function sameDirectionCooldownMs(exitReason?: string | null): number {
  return exitReason === "stop_loss"
    ? SAME_DIRECTION_COOLDOWN_LOSS_MS
    : SAME_DIRECTION_COOLDOWN_WIN_MS;
}

/** Extended moves need more than MACD+EMA — require this many AI reasons. */
export const TIRED_MOVE_AGE_MS = 30 * 60 * 1000;
export const TIRED_MOVE_MIN_REASONS = 3;

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

  if (input.lastSameDirectionCloseAt) {
    const last = Date.parse(input.lastSameDirectionCloseAt);
    const cooldownMs = sameDirectionCooldownMs(input.lastSameDirectionExitReason);
    if (Number.isFinite(last) && now - last < cooldownMs) {
      const remainMin = Math.ceil((cooldownMs - (now - last)) / 60000);
      const kind = input.lastSameDirectionExitReason === "stop_loss" ? "after SL" : "after close";
      return {
        ok: false,
        reason: `same-direction cooldown (${remainMin}m left, ${kind})`,
        requiredConfidence: required,
        details: {
          lastSameDirectionCloseAt: input.lastSameDirectionCloseAt,
          exitReason: input.lastSameDirectionExitReason,
          cooldownMs,
          remainMin,
        },
      };
    }
  }

  if (input.directionAgeMs != null && input.directionAgeMs > MAX_DIRECTION_AGE_MS) {
    const ageMin = Math.round(input.directionAgeMs / 60000);
    return {
      ok: false,
      reason: `move too extended (${ageMin}m active, max ${MAX_DIRECTION_AGE_MS / 60000}m)`,
      requiredConfidence: required,
      details: {
        directionAgeMs: input.directionAgeMs,
        maxDirectionAgeMs: MAX_DIRECTION_AGE_MS,
        ageMin,
      },
    };
  }

  const reasons = input.reasonCount ?? 0;
  if (
    input.directionAgeMs != null &&
    input.directionAgeMs > TIRED_MOVE_AGE_MS &&
    reasons < TIRED_MOVE_MIN_REASONS
  ) {
    const ageMin = Math.round(input.directionAgeMs / 60000);
    return {
      ok: false,
      reason: `weak signal on tired move (${reasons} reasons, ${ageMin}m active)`,
      requiredConfidence: required,
      details: {
        directionAgeMs: input.directionAgeMs,
        reasonCount: reasons,
        minReasons: TIRED_MOVE_MIN_REASONS,
        ageMin,
      },
    };
  }

  return { ok: true, requiredConfidence: required };
}
