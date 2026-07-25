import type { Signal as DbSignal } from "@prisma/client";

export interface BackupAiOption {
  venue: string;
  instrument_name: string;
  option_type: string;
  strike: number;
  expiry: string;
  days_to_expiry: number;
  premium_coin: number;
  premium_usd: number;
  mark_iv: number | null;
  bid_usd: number | null;
  ask_usd: number | null;
  open_interest: number;
  index_price?: number;
}

export interface BackupAiPremiumPlan {
  entry_low: number;
  entry_high: number;
  target_1: number;
  target_2: number;
  stop_loss: number;
}

export interface BackupAiSignal {
  symbol: string;
  timeframe: string;
  direction: string;
  confidence: number;
  risk_level: string;
  entry_range: { low: number; high: number };
  target_1: number;
  target_2: number;
  stop_loss: number;
  underlying_plan: {
    entry_range: { low: number; high: number };
    target_1: number;
    target_2: number;
    stop_loss: number;
  };
  option: BackupAiOption | null;
  premium_plan: BackupAiPremiumPlan | null;
  reasons: string[];
  factor_breakdown: Record<string, unknown>;
  price: number;
  insufficient_data: boolean;
  stale: true;
}

/** Max age for cached backup signals (display-only). */
export const STALE_SIGNAL_MAX_AGE_MS = 30 * 60 * 1000;

export const BACKUP_REASON = "Cached backup — live engine unavailable";

/** Map a persisted Signal row to the phone/API JSON shape. Display-only. */
export function dbSignalToAiSignal(row: DbSignal): BackupAiSignal {
  const reasonsRaw = row.reasons;
  const reasons = Array.isArray(reasonsRaw)
    ? reasonsRaw.map((r) => String(r))
    : [];
  if (!reasons.some((r) => r.includes("Cached backup"))) {
    reasons.unshift(BACKUP_REASON);
  }

  const meta = (row.optionMeta ?? {}) as {
    venue?: string;
    bid_usd?: number | null;
    ask_usd?: number | null;
    open_interest?: number;
    index_price?: number | null;
  };

  const option: BackupAiOption | null =
    row.instrumentName && row.optionType && row.strike != null && row.expiry
      ? {
          venue: meta.venue ?? "delta",
          instrument_name: row.instrumentName,
          option_type: row.optionType,
          strike: row.strike,
          expiry: row.expiry.toISOString(),
          days_to_expiry: row.daysToExpiry ?? 0,
          premium_coin: row.premiumCoin ?? 0,
          premium_usd: row.premiumUsd ?? 0,
          mark_iv: row.markIv,
          bid_usd: meta.bid_usd ?? null,
          ask_usd: meta.ask_usd ?? null,
          open_interest: meta.open_interest ?? 0,
          index_price: meta.index_price ?? undefined,
        }
      : null;

  const premium_plan: BackupAiPremiumPlan | null =
    row.premiumEntryLow != null &&
    row.premiumEntryHigh != null &&
    row.premiumTarget1 != null &&
    row.premiumTarget2 != null &&
    row.premiumStopLoss != null
      ? {
          entry_low: row.premiumEntryLow,
          entry_high: row.premiumEntryHigh,
          target_1: row.premiumTarget1,
          target_2: row.premiumTarget2,
          stop_loss: row.premiumStopLoss,
        }
      : null;

  const entry_range = { low: row.entryLow, high: row.entryHigh };

  return {
    symbol: row.symbol,
    timeframe: row.timeframe,
    direction: row.direction,
    confidence: row.confidence,
    risk_level: row.riskLevel,
    entry_range,
    target_1: row.target1,
    target_2: row.target2,
    stop_loss: row.stopLoss,
    underlying_plan: {
      entry_range,
      target_1: row.target1,
      target_2: row.target2,
      stop_loss: row.stopLoss,
    },
    option,
    premium_plan,
    reasons,
    factor_breakdown: (row.factorBreakdown ?? {}) as Record<string, unknown>,
    price: row.price,
    insufficient_data: false,
    stale: true,
  };
}
