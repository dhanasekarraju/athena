/**
 * Advisory-only entry metadata for AutoTrader — free mode.
 * No strategy signal is rejected here.
 */

export interface EntryGuardInput {
  symbol: string;
  direction: string;
  confidence: number;
  riskLevel: string;
  timeframe?: string | null;
  minConfidence: number;
  skipHighRisk: boolean;
  /** Kept for API compat; live newborn always allows 1m. */
  allowOneMinuteEntry?: boolean;
  /** Kept for API compat; live newborn always allows 15m+. */
  allowSlowTimeframeEntry?: boolean;
  lastStopLossAt?: string | null;
  lastSameDirectionCloseAt?: string | null;
  lastSameDirectionExitReason?: string | null;
  directionAgeMs?: number | null;
  reasonCount?: number;
  nowMs?: number;
}

export interface EntryGuardResult {
  ok: boolean;
  reason?: string;
  requiredConfidence: number;
  details?: Record<string, unknown>;
}

/** @deprecated unused in newborn mode */
export const BLOCKED_ENTRY_TIMEFRAMES = new Set<string>();

/** Compat exports: cooldowns are disabled in free mode. */
export const STOP_LOSS_COOLDOWN_MS = 0;

export const SAME_DIRECTION_COOLDOWN_WIN_MS = 0;
export const SAME_DIRECTION_COOLDOWN_LOSS_MS = 0;
export const SAME_DIRECTION_COOLDOWN_MS = SAME_DIRECTION_COOLDOWN_LOSS_MS;

export function sameDirectionCooldownMs(_exitReason?: string | null): number {
  return SAME_DIRECTION_COOLDOWN_LOSS_MS;
}

/** Effectively off — newborn does not block "tired" moves. */
export const TIRED_MOVE_AGE_MS = 24 * 60 * 60 * 1000;
export const TIRED_MOVE_MIN_REASONS = 1;

/** Compat exports — no longer used as hard floors. */
export const EXAM_5M_MIN_CONFIDENCE = 0;
export const EXAM_15M_MIN_CONFIDENCE = 0;

export function isFiveMinuteTimeframe(timeframe?: string | null): boolean {
  const t = String(timeframe ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return t === "5m" || t === "5min" || t === "5";
}

export function isSlowTimeframe(timeframe?: string | null): boolean {
  const t = String(timeframe ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return t === "15m" || t === "15min" || t === "15" || t === "1h" || t === "4h" || t === "1d";
}

/** Newborn: Settings minConfidence only — no TF floors. */
export function requiredConfidenceForSymbol(
  _symbol: string,
  minConfidence: number,
  _timeframe?: string | null,
): number {
  return Math.max(0, Number(minConfidence) || 0);
}

export function evaluateEntryGuards(input: EntryGuardInput): EntryGuardResult {
  const required = requiredConfidenceForSymbol(input.symbol, input.minConfidence, input.timeframe);
  return {
    ok: true,
    requiredConfidence: required,
    details: {
      advisoryOnly: true,
      confidence: input.confidence,
      riskLevel: input.riskLevel,
      timeframe: input.timeframe,
    },
  };
}
