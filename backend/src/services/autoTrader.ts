import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../utils/env.js";
import { DeltaClient } from "./delta/client.js";
import { selectDeltaOption } from "./delta/selectOption.js";
import { getBotConfig, type RuntimeBotConfig } from "./botConfig.js";

export interface AutonSignal {
  symbol: string;
  timeframe: string;
  direction: string;
  confidence: number;
  risk_level: string;
  price: number;
  insufficient_data?: boolean;
}

/**
 * Cautious Delta options auto-trader.
 * Runtime limits come from BotConfig (editable in the mobile Settings UI).
 */
export class AutoTrader {
  private client: DeltaClient;
  private killed = false;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.client = DeltaClient.fromEnv(env);
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
    this.log.warn({ reason }, "AutoTrader killed — no new entries, exits still monitored");
  }

  resume() {
    this.killed = false;
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
    if (!cfg.autonomousEnabled || this.killed) return;
    if (signal.direction !== "BUY_CALL" && signal.direction !== "BUY_PUT") return;

    if (!cfg.symbols.includes(signal.symbol.toUpperCase())) return;
    if (signal.insufficient_data) {
      this.log.info({ symbol: signal.symbol }, "Skip auto entry: insufficient data");
      return;
    }
    if (signal.confidence < cfg.minConfidence) {
      this.log.info(
        { symbol: signal.symbol, confidence: signal.confidence },
        "Skip auto entry: confidence below threshold",
      );
      return;
    }
    if (cfg.skipHighRisk && signal.risk_level === "High") {
      this.log.info({ symbol: signal.symbol }, "Skip auto entry: High risk");
      return;
    }

    if (this.busy) return;
    this.busy = true;
    try {
      await this.tryEnter(signal, cfg);
    } catch (err) {
      this.log.error({ err, signal }, "AutoTrader entry failed");
    } finally {
      this.busy = false;
    }
  }

  private async tryEnter(signal: AutonSignal, cfg: RuntimeBotConfig): Promise<void> {
    const open = await this.prisma.botPosition.findMany({ where: { status: "OPEN" } });
    const openExposure = open.reduce((s, p) => s + p.entryPremium * p.size, 0);
    const room = cfg.maxOpenExposureInr - openExposure;
    if (room < 50) {
      this.log.info({ openExposure, room }, "Skip auto entry: exposure limit reached");
      return;
    }
    if (open.some((p) => p.underlying === signal.symbol.toUpperCase())) {
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
      this.log.info({ symbol: signal.symbol }, "Skip auto entry: no Delta contract");
      return;
    }

    const premium = selected.ask > 0 ? selected.ask : selected.markPremium;
    if (premium <= 0) return;

    const budget = Math.min(cfg.maxOrderInr, room);
    const size = Math.floor(budget / premium);
    if (size < 1) {
      this.log.info(
        { premium, budget, symbol: selected.productSymbol },
        "Skip auto entry: 1 contract costs more than max order",
      );
      return;
    }

    const notional = size * premium;
    const clientOrderId = `ath-in-${randomUUID().replace(/-/g, "").slice(0, 24)}`;

    let entryOrderId: string | null = null;
    let fillPremium = premium;
    const paper = cfg.paperTrading || !this.client.configured;

    if (paper) {
      entryOrderId = `paper-${clientOrderId}`;
      this.log.warn(
        { paper: true, product: selected.productSymbol, size, premium, notional },
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

    await this.prisma.botPosition.create({
      data: {
        exchange: "delta",
        productId: selected.productId,
        productSymbol: selected.productSymbol,
        underlying: signal.symbol.toUpperCase(),
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
          planned: { notional, budget },
        } as object,
      },
    });
  }

  async monitorOpenPositions(): Promise<void> {
    const cfg = await getBotConfig(this.prisma);
    // Always monitor open positions even if autonomous currently off (exits still apply)
    const open = await this.prisma.botPosition.findMany({ where: { status: "OPEN" } });
    for (const pos of open) {
      try {
        await this.checkExit(pos.id, pos.productSymbol, pos.entryPremium, pos.stopLoss, pos.takeProfit1, pos.size, pos.paper);
      } catch (err) {
        this.log.error({ err, id: pos.id }, "AutoTrader exit check failed");
      }
    }
    // keep cfg referenced for future use (poll cadence stays from env)
    void cfg;
  }

  private async checkExit(
    id: string,
    productSymbol: string,
    entry: number,
    stopLoss: number,
    takeProfit1: number,
    size: number,
    paper: boolean,
  ): Promise<void> {
    const ticker = await this.client.getTicker(productSymbol);
    const mark = this.client.markPrice(ticker);
    if (mark <= 0) return;

    let reason: string | null = null;
    if (mark <= stopLoss) reason = "stop_loss";
    else if (mark >= takeProfit1) reason = "take_profit_1";
    if (!reason) return;

    let exitOrderId: string | null = null;
    if (paper || !this.client.configured) {
      exitOrderId = `paper-exit-${id.slice(0, 12)}`;
      this.log.warn({ paper: true, productSymbol, mark, reason }, "PAPER sell");
    } else {
      const pos = await this.prisma.botPosition.findUnique({ where: { id } });
      if (!pos) return;
      const order = await this.client.placeMarketOrder({
        productId: pos.productId,
        productSymbol,
        side: "sell",
        size,
        clientOrderId: `ath-out-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        reduceOnly: true,
      });
      exitOrderId = String(order.id);
      this.log.info({ exitOrderId, productSymbol, mark, reason }, "LIVE sell submitted");
    }

    const pnl = (mark - entry) * size;
    await this.prisma.botPosition.update({
      where: { id },
      data: {
        status: "CLOSED",
        exitOrderId,
        exitPremium: mark,
        exitReason: reason,
        realizedPnl: pnl,
        closedAt: new Date(),
      },
    });
  }
}

let singleton: AutoTrader | null = null;

export function getAutoTrader(prisma: PrismaClient, log: FastifyBaseLogger): AutoTrader {
  if (!singleton) singleton = new AutoTrader(prisma, log);
  return singleton;
}
