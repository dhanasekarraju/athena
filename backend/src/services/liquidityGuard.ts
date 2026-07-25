/**
 * Liquidity / spread gates before market entry.
 * Pure — no I/O.
 */
export function evaluateLiquidityGuard(input: {
  bid: number;
  ask: number;
  mark: number;
  openInterest: number;
  /** Max (ask-bid)/mid as fraction, e.g. 0.08 = 8% */
  maxSpreadPct: number;
  minOpenInterest: number;
}): { ok: true } | { ok: false; reason: string } {
  const oi = Number(input.openInterest) || 0;
  if (input.minOpenInterest > 0 && oi < input.minOpenInterest) {
    return {
      ok: false,
      reason: `open interest ${oi} < min ${input.minOpenInterest}`,
    };
  }

  const bid = input.bid;
  const ask = input.ask;
  if (bid <= 0 || ask <= 0 || ask < bid) {
    return { ok: false, reason: "no usable bid/ask for spread check" };
  }

  const mid = input.mark > 0 ? input.mark : (bid + ask) / 2;
  if (mid <= 0) return { ok: false, reason: "no mid for spread check" };

  const spreadPct = (ask - bid) / mid;
  if (spreadPct > input.maxSpreadPct) {
    return {
      ok: false,
      reason: `spread ${(spreadPct * 100).toFixed(1)}% > max ${(input.maxSpreadPct * 100).toFixed(1)}%`,
    };
  }

  return { ok: true };
}
