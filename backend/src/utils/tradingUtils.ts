import type { DeltaTicker } from "../services/delta/client";

/**
 * Calculate limit buy price with slippage protection
 * For buying, we want to pay no more than (mark价格 + slippage tolerance)
 * or better (ask price or better if available)
 */
export function calculateLimitBuyPrice(
  ticker: DeltaTicker,
  slippageBps: number = 5 // 5 basis points = 0.05% default slippage tolerance
): number {
  const markPrice = parseFloat(ticker.mark_price ?? "0") || 0;
  const askPrice = parseFloat(ticker.best_ask ?? "0") || 0;

  // If we have a good ask price, use it as the base (we want to buy at ask or better)
  let basePrice = askPrice > 0 ? askPrice : markPrice;

  // If we're using mark price as base, add slippage tolerance
  // If we're using ask price as base, we might still want to allow slight slippage
  // but we can also try to get price improvement (pay less than ask)
  if (askPrice > 0 && markPrice > 0) {
    // If mark is better than ask, we might get price improvement
    // Otherwise, stick with ask plus small slippage
    if (markPrice < askPrice) {
      // Market is pricing below ask - we can try to get even better price
      basePrice = markPrice;
    }
    // Otherwise use ask as base
  }

  // Add slippage tolerance (in basis points)
  const slippageMultiplier = 1 + slippageBps / 10000;
  return basePrice * slippageMultiplier;
}

/**
 * Calculate limit sell price with slippage protection
 * For selling, we want to receive no less than (mark价格 - slippage tolerance)
 * or better (bid price or better if available)
 */
export function calculateLimitSellPrice(
  ticker: DeltaTicker,
  slippageBps: number = 5 // 5 basis points = 0.05% default slippage tolerance
): number {
  const markPrice = parseFloat(ticker.mark_price ?? "0") || 0;
  const bidPrice = parseFloat(ticker.best_bid ?? "0") || 0;

  // If we have a good bid price, use it as the base (we want to sell at bid or better)
  let basePrice = bidPrice > 0 ? bidPrice : markPrice;

  // If we're using mark price as base, subtract slippage tolerance
  // If we're using bid price as base, we might still want to allow slight slippage
  // but we can also try to get price improvement (sell for more than bid)
  if (bidPrice > 0 && markPrice > 0) {
    // If mark is better than bid, we might get price improvement
    // Otherwise, stick with bid minus small slippage
    if (markPrice > bidPrice) {
      // Market is pricing above bid - we can try to get even better price
      basePrice = markPrice;
    }
    // Otherwise use bid as base
  }

  // Subtract slippage tolerance (in basis points)
  const slippageMultiplier = 1 - slippageBps / 10000;
  return basePrice * slippageMultiplier;
}

/**
 * Calculate slippage in basis points between two prices
 */
export function calculateSlippageBps(expectedPrice: number, actualPrice: number, isBuy: boolean): number {
  if (expectedPrice <= 0) return 0;

  let slippage;
  if (isBuy) {
    // For buying: slippage = (actual - expected) / expected
    slippage = (actualPrice - expectedPrice) / expectedPrice;
  } else {
    // For selling: slippage = (expected - actual) / expected
    slippage = (expectedPrice - actualPrice) / expectedPrice;
  }

  return Math.max(0, slippage * 10000); // Convert to basis points
}

/**
 * Enhanced order types supported by Delta exchange
 */
export enum DeltaOrderType {
  MARKET = "market_order",
  LIMIT = "limit_order",
  STOP_MARKET = "stop_market_order",
  STOP_LIMIT = "stop_limit_order"
}

/**
 * Time in force options for orders
 */
export enum TimeInForce {
  IOC = "ioc",          // Immediate or Cancel
  GTC = "gtc",          // Good Till Cancelled
  FOK = "fok",          // Fill or Kill
  GTX = "g tx"          // Good Till Crossing (post-only)
}