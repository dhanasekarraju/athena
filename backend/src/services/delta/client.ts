import crypto from "node:crypto";

export enum DeltaOrderType {
  MARKET = "market_order",
  LIMIT = "limit_order",
  STOP_MARKET = "stop_market_order",
  STOP_LIMIT = "stop_limit_order"
}

export enum TimeInForce {
  IOC = "ioc",          // Immediate or Cancel
  GTC = "gtc",          // Good Till Cancelled
  FOK = "fok",          // Fill or Kill
  GTX = "gtx"           // Good Till Crossing (post-only)
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface DeltaTicker {
  product_id: number;
  symbol: string;
  mark_price?: string;
  best_bid?: string | null;
  best_ask?: string | null;
  /** Legacy / global Delta field — often absent on India tickers. */
  open_interest?: string | number;
  /** India Delta: coin-denominated OI (can be &lt; 10 for thin BTC). */
  oi?: string | number;
  /** India Delta: contract count — prefer this for liquidity guards. */
  oi_contracts?: string | number;
  oi_value?: string | number;
  strike_price?: string | number;
  contract_type?: string;
  contract_value?: string | number;
  close?: string;
  spot_price?: string;
  expiry_time?: number;
  quotes?: {
    mark_price?: string;
    best_bid?: string;
    best_ask?: string;
  };
}

export interface DeltaOrderResult {
  id: number | string;
  product_id: number;
  product_symbol: string;
  size: number;
  side: string;
  state: string;
  average_fill_price?: string;
  limit_price?: string;
  /** Present on some Delta responses — prefer for fill reconciliation. */
  filled_size?: number | string;
  unfilled_size?: number | string;
}

function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export class DeltaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly maxRetries: number = 3,
    private readonly baseDelayMs: number = 1000,
    private readonly maxDelayMs: number = 30000,
  ) {}

  static fromEnv(env: {
    DELTA_BASE_URL: string;
    DELTA_API_KEY: string;
    DELTA_API_SECRET: string;
    DELTA_MAX_RETRIES?: string;
    DELTA_BASE_DELAY_MS?: string;
    DELTA_MAX_DELAY_MS?: string;
  }): DeltaClient {
    return new DeltaClient(
      env.DELTA_BASE_URL.replace(/\/$/, ""),
      env.DELTA_API_KEY,
      env.DELTA_API_SECRET,
      parseInt(env.DELTA_MAX_RETRIES ?? "3", 10),
      parseInt(env.DELTA_BASE_DELAY_MS ?? "1000", 10),
      parseInt(env.DELTA_MAX_DELAY_MS ?? "30000", 10),
    );
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  private shouldRetry(statusCode: number): boolean {
    // Retry on rate limit (429), timeout (408), and server errors (5xx)
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff with full jitter
    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, attempt),
      this.maxDelayMs
    );
    return Math.floor(Math.random() * delay);
  }

  private sign(method: HttpMethod, path: string, query: string, body: string, timestamp: string): string {
    const payload = `${method}${timestamp}${path}${query}${body}`;
    return crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown; auth?: boolean } = {},
    attempt = 0,
  ): Promise<T> {
    const queryEntries = Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== "");
    const queryString = queryEntries.length
      ? `?${new URLSearchParams(queryEntries).toString()}`
      : "";
    const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
    const url = `${this.baseUrl}${path}${queryString}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (opts.auth) {
      if (!this.configured) {
        throw new Error("Delta API keys are not configured");
      }
      const timestamp = Math.floor(Date.now() / 1000).toString();
      headers["api-key"] = this.apiKey;
      headers.timestamp = timestamp;
      headers.signature = this.sign(method, path, queryString, body, timestamp);
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === "GET" || method === "DELETE" ? undefined : body || undefined,
      });
      const json = (await res.json()) as { success?: boolean; result?: T; error?: { message?: string } };
      if (!res.ok || json.success === false) {
        const detail = json.error ? `: ${JSON.stringify(json.error).slice(0, 300)}` : "";
        const error = new Error(
          json.error?.message || `Delta API ${method} ${path} failed (${res.status})${detail}`,
        );

        // Check if we should retry (rate limit or server errors)
        if (this.shouldRetry(res.status) && attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          console.warn({
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delayMs: delay,
            status: res.status,
            method,
            path
          }, `Retrying Delta API request after ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.request<T>(method, path, opts, attempt + 1);
        }

        throw error;
      }
      return json.result as T;
    } catch (error) {
      // Handle network errors
      const err = error as Error;
      if (attempt < this.maxRetries) {
        // For fetch-related errors, we might want to retry
        const errorStr = err.message.toLowerCase();
        if (errorStr.includes('fetch') || errorStr.includes('network') || errorStr.includes('failed to fetch')) {
          const delay = this.calculateDelay(attempt);
          console.warn({
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delayMs: delay,
            method,
            path
          }, `Retrying Delta API request after network error (${delay}ms)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.request<T>(method, path, opts, attempt + 1);
        }
      }

      throw error;
    }
  }

  async getOptionTickers(symbol: string, optionType: "call" | "put"): Promise<DeltaTicker[]> {
    const contract = optionType === "call" ? "call_options" : "put_options";
    const result = await this.request<DeltaTicker[] | { [k: string]: DeltaTicker }>("GET", "/v2/tickers", {
      query: {
        contract_types: contract,
        underlying_asset_symbols: symbol.toUpperCase(),
      },
    });
    if (Array.isArray(result)) return result;
    return Object.values(result ?? {});
  }

  async getTicker(symbol: string): Promise<DeltaTicker> {
    return this.request<DeltaTicker>("GET", `/v2/tickers/${encodeURIComponent(symbol)}`);
  }

  /** Wallet balances (auth). Returns raw Delta wallet rows. */
  async getWalletBalances(): Promise<
    Array<{
      asset_symbol?: string;
      available_balance?: string | number;
      balance?: string | number;
      [k: string]: unknown;
    }>
  > {
    const result = await this.request<
      | Array<Record<string, unknown>>
      | { [k: string]: Record<string, unknown> }
    >("GET", "/v2/wallet/balances", { auth: true });
    if (Array.isArray(result)) return result as Array<{ asset_symbol?: string; available_balance?: string | number; balance?: string | number }>;
    return Object.values(result ?? {}) as Array<{
      asset_symbol?: string;
      available_balance?: string | number;
      balance?: string | number;
    }>;
  }

  async getUsdAvailable(): Promise<number | null> {
    if (!this.configured) return null;
    try {
      const rows = await this.getWalletBalances();
      const usd = rows.find((r) => String(r.asset_symbol || "").toUpperCase() === "USD");
      if (!usd) return 0;
      return toNum(usd.available_balance ?? usd.balance);
    } catch {
      return null;
    }
  }

  /** Live option/futures positions with non-zero size. */
  async getOpenMarginedPositions(): Promise<
    Array<{ productId: number; productSymbol: string; size: number; entryPrice: number }>
  > {
    const result = await this.request<Array<Record<string, unknown>>>("GET", "/v2/positions/margined", {
      auth: true,
    });
    const rows = Array.isArray(result) ? result : [];
    const out: Array<{ productId: number; productSymbol: string; size: number; entryPrice: number }> = [];
    for (const p of rows) {
      const size = toNum(p.size);
      if (size === 0) continue;
      const product = (p.product as Record<string, unknown> | undefined) ?? {};
      const productId = toNum(product.id ?? p.product_id);
      const productSymbol = String(product.symbol ?? p.product_symbol ?? "");
      if (!productId || !productSymbol) continue;
      out.push({
        productId,
        productSymbol,
        size,
        entryPrice: toNum(p.entry_price ?? p.average_open_price),
      });
    }
    return out;
  }

  /** Open (resting) orders. Optionally filter by product. */
  async getOpenOrders(productId?: number): Promise<
    Array<{ id: string; productId: number; productSymbol: string; side: string; size: number; unfilled: number; state: string; clientOrderId: string }>
  > {
    const query: Record<string, string> = { state: "open" };
    if (productId != null) query.product_id = String(productId);
    const result = await this.request<Array<Record<string, unknown>> | { [k: string]: Record<string, unknown> }>(
      "GET",
      "/v2/orders",
      { auth: true, query },
    );
    const rows = Array.isArray(result) ? result : Object.values(result ?? {});
    const out: Array<{
      id: string;
      productId: number;
      productSymbol: string;
      side: string;
      size: number;
      unfilled: number;
      state: string;
      clientOrderId: string;
    }> = [];
    for (const o of rows) {
      const id = String(o.id ?? "");
      if (!id) continue;
      out.push({
        id,
        productId: toNum(o.product_id),
        productSymbol: String(o.product_symbol ?? ""),
        side: String(o.side ?? ""),
        size: toNum(o.size),
        unfilled: toNum(o.unfilled_size ?? o.size),
        state: String(o.state ?? ""),
        clientOrderId: String(o.client_order_id ?? ""),
      });
    }
    return out;
  }

  /** Cancel a resting order. Safe no-op if already filled/cancelled. */
  async cancelOrder(input: { orderId: string | number; productId: number }): Promise<void> {
    await this.request("DELETE", "/v2/orders", {
      auth: true,
      body: { id: Number(input.orderId), product_id: input.productId },
    });
  }

  async placeOrder(input: {
    productId: number;
    productSymbol: string;
    side: "buy" | "sell";
    size: number;
    clientOrderId: string;
    reduceOnly?: boolean;
    orderType?: DeltaOrderType;
    limitPrice?: number;
    timeInForce?: TimeInForce;
    stopPrice?: number;
  }): Promise<DeltaOrderResult> {
    // Default to market order for backward compatibility
    const orderType = input.orderType ?? DeltaOrderType.MARKET;
    const timeInForce = input.timeInForce ?? TimeInForce.IOC;

    // Validate parameters based on order type
    if (
      (orderType === DeltaOrderType.LIMIT || orderType === DeltaOrderType.STOP_LIMIT) &&
      input.limitPrice === undefined
    ) {
      throw new Error("limitPrice is required for limit and stop-limit orders");
    }

    if (
      (orderType === DeltaOrderType.STOP_MARKET || orderType === DeltaOrderType.STOP_LIMIT) &&
      input.stopPrice === undefined
    ) {
      throw new Error("stopPrice is required for stop-market and stop-limit orders");
    }

    const body: any = {
      product_id: input.productId,
      product_symbol: input.productSymbol,
      size: input.size,
      side: input.side,
      order_type: orderType,
      time_in_force: timeInForce,
      reduce_only: input.reduceOnly ?? false,
      client_order_id: input.clientOrderId.slice(0, 36),
    };

    // Add price for limit orders
    if (
      (orderType === DeltaOrderType.LIMIT || orderType === DeltaOrderType.STOP_LIMIT) &&
      input.limitPrice !== undefined
    ) {
      body.limit_price = String(input.limitPrice);
    }

    // Add stop price for stop orders
    if (
      (orderType === DeltaOrderType.STOP_MARKET || orderType === DeltaOrderType.STOP_LIMIT) &&
      input.stopPrice !== undefined
    ) {
      body.stop_price = String(input.stopPrice);
    }

    return this.request<DeltaOrderResult>("POST", "/v2/orders", {
      auth: true,
      body: body,
    });
  }

  async placeMarketOrder(input: {
    productId: number;
    productSymbol: string;
    side: "buy" | "sell";
    size: number;
    clientOrderId: string;
    reduceOnly?: boolean;
  }): Promise<DeltaOrderResult> {
    return this.placeOrder({
      ...input,
      orderType: DeltaOrderType.MARKET,
      timeInForce: TimeInForce.IOC,
    });
  }

  markPrice(t: DeltaTicker): number {
    return toNum(t.quotes?.mark_price ?? t.mark_price ?? t.close);
  }

  bestBid(t: DeltaTicker): number {
    return toNum(t.quotes?.best_bid ?? t.best_bid);
  }

  bestAsk(t: DeltaTicker): number {
    return toNum(t.quotes?.best_ask ?? t.best_ask);
  }
}

/** Parse Delta option symbol forms like C-BTC-65000-240726. */
export function parseDeltaOptionMeta(t: DeltaTicker): {
  strike: number;
  optionType: "call" | "put";
  expiryMs: number;
} | null {
  const sym = (t.symbol || "").toUpperCase();
  const m = sym.match(/^(C|P)-([A-Z0-9]+)-(\d+(?:\.\d+)?)-(\d{6})$/);
  let strike = toNum(t.strike_price);
  let optionType: "call" | "put" | null = null;
  let expiryMs = toNum(t.expiry_time);

  if (m) {
    optionType = m[1] === "C" ? "call" : "put";
    strike = toNum(m[3], strike);
    const dmy = m[4];
    const dd = Number(dmy.slice(0, 2));
    const mm = Number(dmy.slice(2, 4));
    const yy = 2000 + Number(dmy.slice(4, 6));
    expiryMs = Date.UTC(yy, mm - 1, dd, 8, 0, 0);
  } else if (t.contract_type?.includes("call")) {
    optionType = "call";
  } else if (t.contract_type?.includes("put")) {
    optionType = "put";
  }

  if (!optionType || strike <= 0 || expiryMs <= 0) return null;
  return { strike, optionType, expiryMs };
}
