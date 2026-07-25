/**
 * Daily P&L / consecutive SL circuit breaker — pure helpers.
 * Day boundary: Asia/Kolkata (IST) midnight.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Start of current IST calendar day as a UTC Date. */
export function startOfIstTradingDay(nowMs = Date.now()): Date {
  const istMs = nowMs + IST_OFFSET_MS;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  // Midnight IST = UTC midnight-of-that-IST-date minus offset
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - IST_OFFSET_MS);
}

export function evaluateCircuitBreaker(input: {
  /** Sum of realizedPnl for closed live (or paper) trades since IST midnight. */
  dayRealizedPnlInr: number;
  dailyLossLimitInr: number;
  /** How many stop_loss exits in a row at the end of recent closes (newest first). */
  consecutiveStopLosses: number;
  maxConsecutiveStopLosses: number;
}): { trip: false } | { trip: true; why: string } {
  const limit = input.dailyLossLimitInr;
  if (limit > 0 && input.dayRealizedPnlInr <= -limit) {
    return {
      trip: true,
      why: `daily loss ₹${Math.abs(input.dayRealizedPnlInr).toFixed(0)} ≥ limit ₹${limit.toFixed(0)} (IST day)`,
    };
  }
  const maxSl = input.maxConsecutiveStopLosses;
  if (maxSl > 0 && input.consecutiveStopLosses >= maxSl) {
    return {
      trip: true,
      why: `${input.consecutiveStopLosses} consecutive stop-losses ≥ max ${maxSl}`,
    };
  }
  return { trip: false };
}

/** Count trailing stop_loss exits from newest-first exit reasons. */
export function countTrailingStopLosses(exitReasonsNewestFirst: string[]): number {
  let n = 0;
  for (const r of exitReasonsNewestFirst) {
    if (r === "stop_loss") n += 1;
    else break;
  }
  return n;
}
