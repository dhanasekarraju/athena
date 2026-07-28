/**
 * Exam desk constants — Paper 1–3 for Athena long-premium survival.
 * Tuned for small live capital (~₹1–2k): fewer tickets, capped daily bleed.
 */

/** Paper 1: max new live entries per IST calendar day. */
export const EXAM_MAX_DAILY_ENTRIES = 6;

/**
 * Paper 2: max premium outlay as fraction of equity per trade.
 * Micro accounts cannot use classic 1–2% (one contract often costs more) —
 * 12% of equity with daily loss + entry caps still protects the book.
 */
export const EXAM_RISK_PCT_OF_EQUITY = 0.12;

/** Paper 1: minimum Gemini strength when judge is available (also in regime). */
export const EXAM_MIN_TREND_STRENGTH = 55;

/** Paper 3: refuse buys when mark IV (decimal) is richer than this. */
export const EXAM_MAX_MARK_IV = 0.95;

