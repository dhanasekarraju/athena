/**
 * Exam desk position sizing — micro accounts may buy 1 lot when 12% risk
 * alone cannot afford a contract, if cash and equity caps still allow it.
 */

import { EXAM_RISK_PCT_OF_EQUITY } from "./examDesk.js";

/** Max share of equity for a single micro allow-one ticket (35%). */
export const EXAM_MICRO_MAX_SINGLE_PCT = 0.35;

export interface ExamSizeInput {
  maxOrderInr: number;
  exposureRoomInr: number;
  /** Wallet available in INR (usdAvail * usdInr). Null/omit skips wallet caps. */
  walletInr?: number | null;
  /** Equity used for risk % (usually same as wallet for live). */
  equityInr: number;
  costPerContractInr: number;
  riskPct?: number;
  microMaxSinglePct?: number;
}

export interface ExamSizeResult {
  size: number;
  budget: number;
  cashBudget: number;
  riskBudget: number;
  microAllowOne: boolean;
  reason?: string;
}

/**
 * Compute contract size for exam desk.
 * Prefer floor(min(cash, risk) / cost); if 0, allow exactly 1 when
 * cost fits cashBudget and cost <= equity * microMaxSinglePct.
 */
export function sizeExamContracts(input: ExamSizeInput): ExamSizeResult {
  const cost = Math.max(0, Number(input.costPerContractInr) || 0);
  const equity = Math.max(0, Number(input.equityInr) || 0);
  const riskPct = input.riskPct ?? EXAM_RISK_PCT_OF_EQUITY;
  const microPct = input.microMaxSinglePct ?? EXAM_MICRO_MAX_SINGLE_PCT;

  let cashBudget = Math.min(
    Math.max(0, input.maxOrderInr),
    Math.max(0, input.exposureRoomInr),
  );
  if (input.walletInr != null && Number.isFinite(input.walletInr)) {
    cashBudget = Math.min(cashBudget, Math.max(0, input.walletInr) * 0.95);
  }

  const riskBudget = equity * riskPct;
  const preferredBudget = Math.min(cashBudget, riskBudget);

  if (cost <= 0) {
    return {
      size: 0,
      budget: preferredBudget,
      cashBudget,
      riskBudget,
      microAllowOne: false,
      reason: "invalid cost",
    };
  }

  let size = Math.floor(preferredBudget / cost);
  let microAllowOne = false;
  let budget = preferredBudget;

  if (size < 1) {
    const withinCash = cost <= cashBudget;
    const withinMicro = equity > 0 && cost <= equity * microPct;
    if (withinCash && withinMicro) {
      size = 1;
      microAllowOne = true;
      budget = cost;
    } else {
      return {
        size: 0,
        budget: preferredBudget,
        cashBudget,
        riskBudget,
        microAllowOne: false,
        reason: withinCash
          ? `1× ≈ ₹${cost.toFixed(0)} > ${Math.round(microPct * 100)}% equity`
          : `1× ≈ ₹${cost.toFixed(0)} > cash budget ₹${cashBudget.toFixed(0)}`,
      };
    }
  }

  return { size, budget, cashBudget, riskBudget, microAllowOne };
}
