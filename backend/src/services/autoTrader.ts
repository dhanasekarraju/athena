import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../utils/env.js";
import { DeltaClient } from "./delta/client.js";
import { selectDeltaOption, contractCostUsd } from "./delta/selectOption.js";
import { getBotConfig, type RuntimeBotConfig } from "./botConfig.js";

function defaultContractValue(symbol: string): number {
  const u = symbol.toUpperCase();
  if (u.includes("BTC")) return 0.001;
  if (u.includes("ETH")) return 0.01;
  return 1;
}

function positionCostInr(
  entryPremium: number,
  size: number,
  productSymbol: string,
  snapshot: unknown,
  usdInr: number,
): number {
  const snap = snapshot as {
    selected?: { contractValue?: number };
    planned?: { costInr?: number; contractValue?: number };
  } | null;
  if (snap?.planned?.costInr && snap.planned.costInr > 0) {
    // planned.costInr was for the whole fill
    return snap.planned.costInr;
  }
  const cv =
    snap?.selected?.contractValue ??
    snap?.planned?.contractValue ??
    defaultContractValue(productSymbol);
  return contractCostUsd(entryPremium, cv) * size * usdInr;
}

export interface AutonSignal {
  symbol: string;
  timeframe: string;
  direction: string;
  confidence: number;
  risk_level: string;
  price: number;
  insufficient_data?: boolean;
}

export type BotActivityLevel = "info" | "skip" | "trade" | "exit" | "error";

export interface BotActivityEvent {
  id: string;
  at: string;
  level: BotActivityLevel;
  message: string;
  symbol?: string;
  details?: Record<string, unknown>;
}

const ACTIVITY_LIMIT = 150;

/**
 * Cautious Delta options auto-trader.
 * Runtime limits come from BotConfig (editable in the mobile Settings UI).
 */
export class AutoTrader {
  private client: DeltaClient;
  private killed = false;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private readonly activity: BotActivityEvent[] = [];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.client = DeltaClient.fromEnv(env);
  }

  getActivity(limit = 80): BotActivityEvent[] {
    const n = Math.min(Math.max(limit, 1), ACTIVITY_LIMIT);
    return this.activity.slice(0, n);
  }

  private pushActivity(
    level: BotActivityLevel,
    message: string,
    opts: { symbol?: string; details?: Record<string, unknown> } = {},
  ): void {
    this.activity.unshift({
      id: randomUUID(),
      at: new Date().toISOString(),
      level,
      message,
      symbol: opts.symbol,
      details: opts.details,
    });
    if (this.activity.length > ACTIVITY_LIMIT) this.activity.length = ACTIVITY_LIMIT;
  }

  async status() {
    const cfg = await getBotConfig(this.prisma);
    return {
      ...cfg,
      autonomous: cfg.autonomousEnabled && !this.killed,
      killed: this.killed,
      paper: cfg.paperTrading,
      deltaConfigured: this.client.configured,
      maxOrderInr: cfg.maxOrderInr,
      maxOpenExposureInr: cfg.maxOpenExposureInr,
      minConfidence: cfg.minConfidence,
      symbols: cfg.symbols,
      slFraction: cfg.slFraction,
      tp1Fraction: cfg.tp1Fraction,
      skipHighRisk: cfg.skipHighRisk,
    };
  }

  kill(reason = "manual_kill") {
    this.killed = true;
    this.pushActivity("info", `Kill switch ON (${reason})`);
    this.log.warn({ reason }, "AutoTrader killed — no new entries, exits still monitored");
  }

  resume() {
    this.killed = false;
    this.pushActivity("info", "Kill switch OFF — auto buys can resume");
    this.log.info("AutoTrader resumed");
  }

  startMonitor() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.monitorOpenPositions();
    }, env.BOT_POLL_MS);
    this.log.info({ everyMs: env.BOT_POLL_MS }, "AutoTrader position monitor started");
  }

  stopMonitor() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async onSignal(signal: AutonSignal): Promise<void> {
    const cfg = await getBotConfig(this.prisma);
    const sym = signal.symbol.toUpperCase();

    if (signal.direction !== "BUY_CALL" && signal.direction !== "BUY_PUT") {
      return;
    }

    if (!cfg.autonomousEnabled) {
      this.pushActivity("skip", `${sym} ${signal.direction} skipped — Auto is OFF`, {
        symbol: sym,
        details: { confidence: signal.confidence },
      });
      return;
    }
    if (this.killed) {
      this.pushActivity("skip", `${sym} ${signal.direction} skipped — kill switch ON`, {
        symbol: sym,
        details: { confidence: signal.confidence },
      });
      return;
    }

    if (!cfg.symbols.includes(sym)) {
      this.pushActivity("skip", `${sym} skipped — not in bot symbols`, {
        symbol: sym,
        details: { symbols: cfg.symbols },
      });
      return;
    }
    if (signal.insufficient_data) {
      this.pushActivity("skip", `${sym} skipped — insufficient data`, { symbol: sym });
      this.log.info({ symbol: signal.symbol }, "Skip auto entry: insufficient data");
      return;
    }
    if (signal.confidence < cfg.minConfidence) {
      this.pushActivity(
        "skip",
        `${sym} ${signal.direction} skipped — confidence ${signal.confidence} < ${cfg.minConfidence}`,
        {
          symbol: sym,
          details: { confidence: signal.confidence, minConfidence: cfg.minConfidence },
        },
      );
      this.log.info(
        { symbol: signal.symbol, confidence: signal.confidence },
        "Skip auto entry: confidence below threshold",
      );
      return;
    }
    if (cfg.skipHighRisk && signal.risk_level === "High") {
      this.pushActivity("skip", `${sym} skipped — High risk filter`, {
        symbol: sym,
        details: { risk_level: signal.risk_level },
      });
      this.log.info({ symbol: signal.symbol }, "Skip auto entry: High risk");
      return;
    }

    if (this.busy) {
      this.pushActivity("skip", `${sym} skipped — bot busy`, { symbol: sym });
      return;
    }
    this.busy = true;
    try {
      await this.tryEnter(signal, cfg);
    } catch (err) {
      this.pushActivity("error", `${sym} entry failed`, {
        symbol: sym,
        details: { error: String(err) },
      });
      this.log.error({ err, signal }, "AutoTrader entry failed");
    } finally {
      this.busy = false;
    }
  }

  private async tryEnter(signal: AutonSignal, cfg: RuntimeBotConfig): Promise<void> {
    const sym = signal.symbol.toUpperCase();
    const usdInr = env.USD_INR_RATE;
    const paperMode = cfg.paperTrading || !this.client.configured;
    const open = await this.prisma.botPosition.findMany({
      where: { status: "OPEN", paper: paperMode },
    });
    const openExposure = open.reduce(
      (s, p) => s + positionCostInr(p.entryPremium, p.size, p.productSymbol, p.signalSnapshot, usdInr),
      0,
    );
    const room = cfg.maxOpenExposureInr - openExposure;
    if (room < 50) {
      this.pushActivity("skip", `${sym} skipped — exposure limit`, {
        symbol: sym,
        details: { openExposure: Math.round(openExposure), room: Math.round(room) },
      });
      this.log.info({ openExposure, room }, "Skip auto entry: exposure limit reached");
      return;
    }
    if (open.some((p) => p.underlying === sym)) {
      this.pushActivity("skip", `${sym} skipped — already open on underlying`, { symbol: sym });
      this.log.info({ symbol: signal.symbol }, "Skip auto entry: already open on underlying");
      return;
    }

    const optionType = signal.direction === "BUY_CALL" ? "call" : "put";
    const tickers = await this.client.getOptionTickers(signal.symbol, optionType);
    const selected = selectDeltaOption(tickers, {
      direction: signal.direction as "BUY_CALL" | "BUY_PUT",
      spot: signal.price,
    });
    if (!selected) {
      this.pushActivity("skip", `${sym} skipped — no Delta contract`, { symbol: sym });
      this.log.info({ symbol: signal.symbol }, "Skip auto entry: no Delta contract");
      return;
    }

    const premium = selected.ask > 0 ? selected.ask : selected.markPremium;
    if (premium <= 0) {
      this.pushActivity("skip", `${sym} skipped — premium ≤ 0`, {
        symbol: sym,
        details: { product: selected.productSymbol },
      });
      return;
    }

    const costPerContractUsd = contractCostUsd(premium, selected.contractValue);
    const costPerContractInr = costPerContractUsd * usdInr;
    if (costPerContractInr <= 0) return;

    const budget = Math.min(cfg.maxOrderInr, room);
    const size = Math.floor(budget / costPerContractInr);
    if (size < 1) {
      this.pushActivity(
        "skip",
        `${sym} skipped — 1× ${selected.productSymbol} ≈ ₹${costPerContractInr.toFixed(0)} > max ₹${budget}`,
        {
          symbol: sym,
          details: {
            premiumUsd: premium,
            contractValue: selected.contractValue,
            costPerContractUsd,
            costPerContractInr,
            budget,
            product: selected.productSymbol,
          },
        },
      );
      this.log.info(
        { premium, costPerContractInr, budget, symbol: selected.productSymbol },
        "Skip auto entry: 1 contract costs more than max order",
      );
      return;
    }

    const notionalInr = size * costPerContractInr;
    const notionalUsd = size * costPerContractUsd;
    const clientOrderId = `ath-in-${randomUUID().replace(/-/g, "").slice(0, 24)}`;

    let entryOrderId: string | null = null;
    let fillPremium = premium;
    const paper = cfg.paperTrading || !this.client.configured;

    if (paper) {
      entryOrderId = `paper-${clientOrderId}`;
      this.log.warn(
        {
          paper: true,
          product: selected.productSymbol,
          size,
          premium,
          contractValue: selected.contractValue,
          notionalInr,
          notionalUsd,
        },
        "PAPER buy (no live order)",
      );
    } else {
      const order = await this.client.placeMarketOrder({
        productId: selected.productId,
        productSymbol: selected.productSymbol,
        side: "buy",
        size,
        clientOrderId,
      });
      entryOrderId = String(order.id);
      fillPremium = Number(order.average_fill_price || premium) || premium;
      this.log.info({ orderId: entryOrderId, product: selected.productSymbol, size }, "LIVE buy submitted");
    }

    const fillCostInr =
      contractCostUsd(fillPremium, selected.contractValue) * size * usdInr;

    await this.prisma.botPosition.create({
      data: {
        exchange: "delta",
        productId: selected.productId,
        productSymbol: selected.productSymbol,
        underlying: sym,
        direction: signal.direction,
        size,
        entryPremium: fillPremium,
        stopLoss: fillPremium * (1 - cfg.slFraction),
        takeProfit1: fillPremium * (1 + cfg.tp1Fraction),
        status: "OPEN",
        paper,
        entryOrderId,
        signalSnapshot: {
          timeframe: signal.timeframe,
          confidence: signal.confidence,
          risk_level: signal.risk_level,
          spot: signal.price,
          selected,
          planned: {
            notionalInr: fillCostInr,
            notionalUsd,
            costInr: fillCostInr,
            costPerContractInr,
            contractValue: selected.contractValue,
            usdInr,
            budget,
          },
        } as object,
      },
    });

    this.pushActivity(
      "trade",
      `${paper ? "PAPER" : "LIVE"} BUY ${signal.direction} ${selected.productSymbol} ×${size} @ ${fillPremium.toFixed(2)} (≈₹${fillCostInr.toFixed(0)})`,
      {
        symbol: sym,
        details: {
          product: selected.productSymbol,
          size,
          premium: fillPremium,
          contractValue: selected.contractValue,
          notionalInr: fillCostInr,
          paper,
          confidence: signal.confidence,
        },
      },
    );
  }

  async monitorOpenPositions(): Promise<void> {
    const cfg = await getBotConfig(this.prisma);
    const open = await this.prisma.botPosition.findMany({ where: { status: "OPEN" } });
    for (const pos of open) {
      try {
        await this.checkExit(pos);
      } catch (err) {
        this.log.error({ err, id: pos.id }, "AutoTrader exit check failed");
      }
    }
    void cfg;
  }

  /** Wipe all paper BotPositions (used when switching to live). */
  async clearPaperBook(reason = "switched_to_live"): Promise<number> {
    const result = await this.prisma.botPosition.deleteMany({ where: { paper: true } });
    this.pushActivity("info", `Paper book cleared (${result.count} rows) — ${reason}`);
    this.log.warn({ count: result.count, reason }, "Paper BotPosition rows deleted");
    return result.count;
  }

  /** Manual close from Portfolio UI (paper or live). */
  async closePosition(id: string): Promise<{ ok: true; pnl: number; mark: number; paper: boolean }> {
    const pos = await this.prisma.botPosition.findUnique({ where: { id } });
    if (!pos || pos.status !== "OPEN") {
      throw Object.assign(new Error("Position not found or already closed"), { statusCode: 404 });
    }
    const ticker = await this.client.getTicker(pos.productSymbol);
    let mark = this.client.markPrice(ticker);
    if (mark <= 0) mark = pos.entryPremium;
    return this.executeExit(pos, mark, "manual_close");
  }

  private async checkExit(pos: {
    id: string;
    productId: number;
    productSymbol: string;
    entryPremium: number;
    stopLoss: number;
    takeProfit1: number;
    size: number;
    paper: boolean;
    signalSnapshot: unknown;
  }): Promise<void> {
    const ticker = await this.client.getTicker(pos.productSymbol);
    const mark = this.client.markPrice(ticker);
    if (mark <= 0) return;

    let reason: string | null = null;
    if (mark <= pos.stopLoss) reason = "stop_loss";
    else if (mark >= pos.takeProfit1) reason = "take_profit_1";
    if (!reason) return;

    await this.executeExit(pos, mark, reason);
  }

  private async executeExit(
    pos: {
      id: string;
      productId: number;
      productSymbol: string;
      entryPremium: number;
      size: number;
      paper: boolean;
      signalSnapshot: unknown;
    },
    mark: number,
    reason: string,
  ): Promise<{ ok: true; pnl: number; mark: number; paper: boolean }> {
    let exitOrderId: string | null = null;
    if (pos.paper || !this.client.configured) {
      exitOrderId = `paper-exit-${pos.id.slice(0, 12)}`;
      this.log.warn({ paper: true, productSymbol: pos.productSymbol, mark, reason }, "PAPER sell");
    } else {
      const order = await this.client.placeMarketOrder({
        productId: pos.productId,
        productSymbol: pos.productSymbol,
        side: "sell",
        size: pos.size,
        clientOrderId: `ath-out-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        reduceOnly: true,
      });
      exitOrderId = String(order.id);
      this.log.info({ exitOrderId, productSymbol: pos.productSymbol, mark, reason }, "LIVE sell submitted");
    }

    const snap = pos.signalSnapshot as {
      selected?: { contractValue?: number };
      planned?: { contractValue?: number };
    } | null;
    const cv =
      snap?.selected?.contractValue ??
      snap?.planned?.contractValue ??
      defaultContractValue(pos.productSymbol);
    const pnlUsd = (mark - pos.entryPremium) * pos.size * cv;
    const pnl = pnlUsd * env.USD_INR_RATE;

    await this.prisma.botPosition.update({
      where: { id: pos.id },
      data: {
        status: "CLOSED",
        exitOrderId,
        exitPremium: mark,
        exitReason: reason,
        realizedPnl: pnl,
        closedAt: new Date(),
      },
    });

    this.pushActivity(
      "exit",
      `${pos.paper ? "PAPER" : "LIVE"} EXIT ${pos.productSymbol} (${reason}) mark=${mark.toFixed(2)} pnl≈₹${pnl.toFixed(0)}`,
      {
        details: { productSymbol: pos.productSymbol, reason, mark, pnl, paper: pos.paper },
      },
    );

    return { ok: true, pnl, mark, paper: pos.paper };
  }
}

let singleton: AutoTrader | null = null;

export function getAutoTrader(prisma: PrismaClient, log: FastifyBaseLogger): AutoTrader {
  if (!singleton) singleton = new AutoTrader(prisma, log);
  return singleton;
}
