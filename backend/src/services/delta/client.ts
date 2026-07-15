import crypto from "node:crypto";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface DeltaTicker {
  product_id: number;
  symbol: string;
  mark_price?: string;
  best_bid?: string | null;
  best_ask?: string | null;
  open_interest?: string | number;
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
  ) {}

  static fromEnv(env: {
    DELTA_BASE_URL: string;
    DELTA_API_KEY: string;
    DELTA_API_SECRET: string;
  }): DeltaClient {
    return new DeltaClient(
      env.DELTA_BASE_URL.replace(/\/$/, ""),
      env.DELTA_API_KEY,
      env.DELTA_API_SECRET,
    );
  }

  get configured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  private sign(method: HttpMethod, path: string, query: string, body: string, timestamp: string): string {
    const payload = `${method}${timestamp}${path}${query}${body}`;
    return crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown; auth?: boolean } = {},
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

    const res = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "DELETE" ? undefined : body || undefined,
    });
    const json = (await res.json()) as { success?: boolean; result?: T; error?: { message?: string } };
    if (!res.ok || json.success === false) {
      throw new Error(json.error?.message || `Delta API ${method} ${path} failed (${res.status})`);
    }
    return json.result as T;
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

  async placeMarketOrder(input: {
    productId: number;
    productSymbol: string;
    side: "buy" | "sell";
    size: number;
    clientOrderId: string;
    reduceOnly?: boolean;
  }): Promise<DeltaOrderResult> {
    return this.request<DeltaOrderResult>("POST", "/v2/orders", {
      auth: true,
      body: {
        product_id: input.productId,
        product_symbol: input.productSymbol,
        size: input.size,
        side: input.side,
        order_type: "market_order",
        time_in_force: "ioc",
        reduce_only: input.reduceOnly ?? false,
        client_order_id: input.clientOrderId.slice(0, 36),
      },
    });
  }

  markPrice(t: DeltaTicker): number {
    return toNum(t.quotes?.mark_price ?? t.mark_price ?? t.close);
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
