/**
 * Newborn desk — free to trade within wallet / maxOrder.
 * Parent asked for fresh start: no tight 6/35 exam bars.
 */

/** Soft daily spray cap (high). 0 would disable — keep a ceiling for accidents. */
export const EXAM_MAX_DAILY_ENTRIES = 40;

/**
 * Prefer up to this fraction of equity per ticket; cash + maxOrder still bind.
 * Near 1.0 ≈ use almost full free wallet for one ticket on micro accounts.
 */
export const EXAM_RISK_PCT_OF_EQUITY = 0.85;

/** Soft trend strength when Gemini is live (was 55). */
export const EXAM_MIN_TREND_STRENGTH = 35;

/** Soft IV ceiling for buyers. */
export const EXAM_MAX_MARK_IV = 1.2;
