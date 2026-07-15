import { parseDeltaOptionMeta, type DeltaTicker } from "./client.js";

function markPrice(t: DeltaTicker): number {
  const n = Number(t.quotes?.mark_price ?? t.mark_price ?? t.close);
  return Number.isFinite(n) ? n : 0;
}

function bidAsk(t: DeltaTicker): { bid: number; ask: number } {
  const bid = Number(t.quotes?.best_bid ?? t.best_bid ?? 0);
  const ask = Number(t.quotes?.best_ask ?? t.best_ask ?? 0);
  return {
    bid: Number.isFinite(bid) ? bid : 0,
    ask: Number.isFinite(ask) ? ask : 0,
  };
}

export interface SelectedDeltaOption {
  productId: number;
  productSymbol: string;
  optionType: "call" | "put";
  strike: number;
  expiryIso: string;
  daysToExpiry: number;
  markPremium: number;
  bid: number;
  ask: number;
  openInterest: number;
  /** Underlying units per 1 contract (BTC opts ~0.001, ETH ~0.01). */
  contractValue: number;
}

function defaultContractValue(symbol: string): number {
  const u = symbol.toUpperCase();
  if (u.includes("BTC")) return 0.001;
  if (u.includes("ETH")) return 0.01;
  return 1;
}

/**
 * USD cash to open/close 1 contract ≈ premium(USD/unit) × contract_value.
 */
export function contractCostUsd(premium: number, contractValue: number): number {
  const cv = contractValue > 0 ? contractValue : 1;
  return premium * cv;
}

/**
 * Pick a Delta option for a directional signal.
 * Prefer DTE 3–14, ~1 ATR OTM, then highest OI.
 */
export function selectDeltaOption(
  tickers: DeltaTicker[],
  opts: {
    direction: "BUY_CALL" | "BUY_PUT";
    spot: number;
    atr?: number;
    now?: Date;
  },
): SelectedDeltaOption | null {
  const optionType = opts.direction === "BUY_CALL" ? "call" : "put";
  const now = opts.now ?? new Date();
  const atr = opts.atr && opts.atr > 0 ? opts.atr : opts.spot * 0.01;
  const target = opts.spot + (optionType === "call" ? atr : -atr);

  type Cand = {
    t: DeltaTicker;
    meta: NonNullable<ReturnType<typeof parseDeltaOptionMeta>>;
    dte: number;
    mark: number;
  };
  const cands: Cand[] = [];

  for (const t of tickers) {
    const meta = parseDeltaOptionMeta(t);
    if (!meta || meta.optionType !== optionType) continue;
    const dte = (meta.expiryMs - now.getTime()) / 86_400_000;
    if (dte < 2) continue;
    if (optionType === "call" && meta.strike < opts.spot) continue;
    if (optionType === "put" && meta.strike > opts.spot) continue;
    const mark = markPrice(t);
    if (mark <= 0) continue;
    cands.push({ t, meta, dte, mark });
  }

  if (!cands.length) return null;

  const preferred = cands.filter((c) => c.dte >= 3 && c.dte <= 14);
  const pool = preferred.length ? preferred : cands;

  pool.sort((a, b) => {
    const da = Math.abs(a.meta.strike - target);
    const db = Math.abs(b.meta.strike - target);
    if (da !== db) return da - db;
    const oiA = Number(a.t.open_interest ?? 0);
    const oiB = Number(b.t.open_interest ?? 0);
    if (oiB !== oiA) return oiB - oiA;
    const { bid: bidA, ask: askA } = bidAsk(a.t);
    const { bid: bidB, ask: askB } = bidAsk(b.t);
    const spreadA = askA > 0 && bidA > 0 ? askA - bidA : 1e9;
    const spreadB = askB > 0 && bidB > 0 ? askB - bidB : 1e9;
    return spreadA - spreadB;
  });

  const best = pool[0];
  const { bid, ask } = bidAsk(best.t);
  const contractValue = toFinite(best.t.contract_value, defaultContractValue(best.t.symbol));
  return {
    productId: best.t.product_id,
    productSymbol: best.t.symbol,
    optionType,
    strike: best.meta.strike,
    expiryIso: new Date(best.meta.expiryMs).toISOString(),
    daysToExpiry: Math.round(best.dte * 10) / 10,
    markPremium: best.mark,
    bid,
    ask,
    openInterest: Number(best.t.open_interest ?? 0),
    contractValue,
  };
}

function toFinite(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
