import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../utils/env.js";
import { DeltaClient } from "./delta/client.js";
import { selectDeltaOption, contractCostUsd } from "./delta/selectOption.js";
import { getBotConfig, type RuntimeBotConfig } from "./botConfig.js";
import { evaluateEntryGuards, SAME_DIRECTION_COOLDOWN_LOSS_MS, STOP_LOSS_COOLDOWN_MS } from "./entryGuards.js";
import { getDirectionAgeMs } from "./signalFreshness.js";
import { botActivityToFeedItem, publishBotFeed } from "./botFeed.js";
import { getTrendVerdict, verdictAllows } from "./trendJudge.js";
import { buildEntryLevels, decideLongExit } from "./exitLogic.js";

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
  /** AI option premium plan (USD). TP1 + SL used independently; TP2 ignored for auto-exit. */
  premium_entry?: number | null;
  premium_target_1?: number | null;
  premium_target_2?: number | null;
  premium_stop_loss?: number | null;
  reasons?: string[];
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

    // Mirror into the News tab so the app shows what the bot is doing.
    void publishBotFeed(this.prisma, this.log, botActivityToFeedItem(level, message));
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

    // Signal-driven exits run for CALL/PUT/HOLD — decide how much to sell from thesis change.
    if (cfg.autonomousEnabled && !this.killed && cfg.symbols.includes(sym)) {
      try {
        await this.maybeSignalExit(signal, cfg);
      } catch (err) {
        this.log.error({ err, symbol: sym }, "Signal-driven exit failed");
      }
    }

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

    const paperMode = cfg.paperTrading || !this.client.configured;
    const nowMs = Date.now();
    // SL cooldown is same-direction only. CALL stop → PUT may enter immediately
    // (flip is the thesis); same-side revenge is what we pause.
    const recentStop = await this.prisma.botPosition.findFirst({
      where: {
        underlying: sym,
        direction: signal.direction,
        status: "CLOSED",
        exitReason: "stop_loss",
        paper: paperMode,
        closedAt: { gte: new Date(nowMs - STOP_LOSS_COOLDOWN_MS) },
      },
      orderBy: { closedAt: "desc" },
      select: { closedAt: true },
    });
    const recentSameDir = await this.prisma.botPosition.findFirst({
      where: {
        underlying: sym,
        direction: signal.direction,
        status: "CLOSED",
        paper: paperMode,
        closedAt: { gte: new Date(nowMs - SAME_DIRECTION_COOLDOWN_LOSS_MS) },
      },
      orderBy: { closedAt: "desc" },
      select: { closedAt: true, exitReason: true },
    });
    const directionAgeMs = await getDirectionAgeMs(
      this.prisma,
      sym,
      signal.direction,
      cfg.minConfidence,
      nowMs,
    );

    const guard = evaluateEntryGuards({
      symbol: sym,
      direction: signal.direction,
      confidence: signal.confidence,
      riskLevel: signal.risk_level,
      timeframe: signal.timeframe,
      minConfidence: cfg.minConfidence,
      skipHighRisk: cfg.skipHighRisk,
      lastStopLossAt: recentStop?.closedAt?.toISOString() ?? null,
      lastSameDirectionCloseAt: recentSameDir?.closedAt?.toISOString() ?? null,
      lastSameDirectionExitReason: recentSameDir?.exitReason ?? null,
      directionAgeMs,
      reasonCount: signal.reasons?.length ?? 0,
      nowMs,
    });
    if (!guard.ok) {
      this.pushActivity("skip", `${sym} ${signal.direction} skipped — ${guard.reason}`, {
        symbol: sym,
        details: {
          ...guard.details,
          requiredConfidence: guard.requiredConfidence,
          timeframe: signal.timeframe,
        },
      });
      this.log.info(
        {
          symbol: signal.symbol,
          reason: guard.reason,
          confidence: signal.confidence,
          requiredConfidence: guard.requiredConfidence,
          timeframe: signal.timeframe,
        },
        "Skip auto entry: entry guard",
      );
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

  /**
   * Signal-driven exits are full-position only: one buy, one sell (fees matter).
   * The single case is a real flip — the AI now says the opposite direction with
   * entry-grade confidence. HOLD / fading confidence never sell; price SL/TP/trail
   * in the monitor loop remain the safety net.
   */
  private async maybeSignalExit(signal: AutonSignal, cfg: RuntimeBotConfig): Promise<void> {
    const sym = signal.symbol.toUpperCase();
    if (signal.direction !== "BUY_CALL" && signal.direction !== "BUY_PUT") return;
    if ((signal.confidence ?? 0) < cfg.minConfidence) return;

    const paperMode = cfg.paperTrading || !this.client.configured;
    const open = await this.prisma.botPosition.findMany({
      where: { status: "OPEN", underlying: sym, paper: paperMode },
    });
    if (!open.length) return;

    for (const pos of open) {
      const isFlip =
        (pos.direction === "BUY_CALL" && signal.direction === "BUY_PUT") ||
        (pos.direction === "BUY_PUT" && signal.direction === "BUY_CALL");
      if (!isFlip) continue;

      // Grace period: give a fresh position time to work before a flip can
      // close it (price SL/TP/trail still protect it every ~5s).
      const ageMs = Date.now() - new Date(pos.openedAt).getTime();
      if (ageMs < 10 * 60 * 1000) continue;

      let exitPx = pos.entryPremium;
      try {
        const t = await this.client.getTicker(pos.productSymbol);
        const bid = this.client.bestBid(t);
        const mark = this.client.markPrice(t);
        exitPx = bid > 0 ? bid : mark > 0 ? mark : pos.entryPremium;
      } catch {
        // keep entry
      }

      this.pushActivity(
        "exit",
        `Signal flip exit ${pos.productSymbol} ×${pos.size} (full) conf=${signal.confidence} — AI now ${signal.direction}`,
        {
          symbol: sym,
          details: {
            reason: "signal_flip",
            sellSize: pos.size,
            confidence: signal.confidence,
            signalDirection: signal.direction,
          },
        },
      );

      await this.executeExit(pos, exitPx, "signal_flip", {
        sellSize: pos.size,
        signalMeta: {
          confidence: signal.confidence,
          direction: signal.direction,
          detail: `flip to ${signal.direction} @ conf ${signal.confidence}`,
        },
      });
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

    // Gemini trend judge: entry must agree with the higher-level trend; chop blocks.
    // After an opposite-side stop-loss, require 1m+5m aligned (flip on clear reverse).
    // Fails open if the judge is unavailable.
    const oppositeDir = signal.direction === "BUY_CALL" ? "BUY_PUT" : "BUY_CALL";
    const recentOppositeStop = await this.prisma.botPosition.findFirst({
      where: {
        underlying: sym,
        direction: oppositeDir,
        status: "CLOSED",
        exitReason: "stop_loss",
        paper: paperMode,
        closedAt: { gte: new Date(Date.now() - 90 * 60 * 1000) },
      },
      orderBy: { closedAt: "desc" },
      select: { closedAt: true, direction: true },
    });
    const flipAfterSl = recentOppositeStop != null;

    const verdict = await getTrendVerdict(sym, this.log);
    if (verdict.source === "gemini") {
      void publishBotFeed(this.prisma, this.log, {
        key: `trend:${sym}:${verdict.trend}`,
        minIntervalMs: env.TREND_JUDGE_TTL_MS,
        title: `Gemini on ${sym}: ${verdict.trend.toUpperCase()} (${verdict.strength}) — ${verdict.reason}`,
        source: "Athena • Gemini",
        sentiment: verdict.trend === "up" ? "Bullish" : verdict.trend === "down" ? "Bearish" : "Neutral",
        score: verdict.strength,
      });
    }
    const trendGate = verdictAllows(signal.direction as "BUY_CALL" | "BUY_PUT", verdict, {
      requireCoreFrames: flipAfterSl,
    });
    if (!trendGate.ok) {
      this.pushActivity("skip", `${sym} ${signal.direction} skipped — ${trendGate.why}`, {
        symbol: sym,
        details: {
          trend: verdict.trend,
          strength: verdict.strength,
          reason: verdict.reason,
          frames: verdict.frames,
          flipAfterSl,
          confidence: signal.confidence,
        },
      });
      this.log.info(
        { symbol: sym, direction: signal.direction, verdict, flipAfterSl },
        "Skip auto entry: trend judge",
      );
      return;
    }
    if (flipAfterSl) {
      this.pushActivity(
        "info",
        `${sym} ${signal.direction} flip after ${oppositeDir} SL — 1m+5m ok`,
        {
          symbol: sym,
          details: {
            oppositeStopAt: recentOppositeStop.closedAt?.toISOString(),
            frames: verdict.frames,
            strength: verdict.strength,
          },
        },
      );
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

    let budget = Math.min(cfg.maxOrderInr, room);
    // Cap by what the wallet can actually pay — otherwise Delta rejects the
    // order with a 400 and we retry forever on every poll.
    if (!paperMode) {
      try {
        const usdAvail = await this.client.getUsdAvailable();
        if (usdAvail != null) budget = Math.min(budget, usdAvail * usdInr * 0.95);
      } catch (err) {
        this.log.warn({ err }, "Could not read wallet balance before sizing");
      }
    }
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
    const paper = paperMode;

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

    // SL + TP1 independent: tighter of settings/AI for SL; AI TP1 capped near settings (never wait for TP2).
    const levels = buildEntryLevels({
      fillPremium,
      slFraction: cfg.slFraction,
      tp1Fraction: cfg.tp1Fraction,
      aiEntry: signal.premium_entry,
      aiTp1: signal.premium_target_1,
      aiTp2: signal.premium_target_2,
      aiSl: signal.premium_stop_loss,
    });
    const { stopLoss, takeProfit1, tpSource, slSource } = levels;

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
        stopLoss,
        takeProfit1,
        status: "OPEN",
        paper,
        entryOrderId,
        signalSnapshot: {
          timeframe: signal.timeframe,
          confidence: signal.confidence,
          risk_level: signal.risk_level,
          spot: signal.price,
          selected,
          tpSource,
          slSource,
          peakExitPx: fillPremium,
          originalSize: size,
          aiPremium: {
            entry: signal.premium_entry ?? null,
            target_1: signal.premium_target_1 ?? null,
            target_2: signal.premium_target_2 ?? null,
            stop_loss: signal.premium_stop_loss ?? null,
          },
          planned: {
            notionalInr: fillCostInr,
            notionalUsd,
            costInr: fillCostInr,
            costPerContractInr,
            contractValue: selected.contractValue,
            usdInr,
            budget,
            stopLoss,
            takeProfit1,
            slFraction: cfg.slFraction,
            tp1Fraction: cfg.tp1Fraction,
          },
        } as object,
      },
    });

    this.pushActivity(
      "trade",
      `${paper ? "PAPER" : "LIVE"} BUY ${signal.direction} ${selected.productSymbol} ×${size} @ ${fillPremium.toFixed(2)} (≈₹${fillCostInr.toFixed(0)}) SL ${stopLoss.toFixed(2)} [${slSource}] TP ${takeProfit1.toFixed(2)} [${tpSource}]`,
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
          tpSource,
          slSource,
          stopLoss,
          takeProfit1,
        },
      },
    );
  }

  async monitorOpenPositions(): Promise<void> {
    const cfg = await getBotConfig(this.prisma);
    const open = await this.prisma.botPosition.findMany({ where: { status: "OPEN" } });
    // Sync live books: if closed on Delta outside the app, mark Athena closed
    if (!cfg.paperTrading && this.client.configured) {
      try {
        await this.syncExternalCloses(open.filter((p) => !p.paper));
      } catch (err) {
        this.log.error({ err }, "Delta position sync failed");
      }
    }
    const stillOpen = await this.prisma.botPosition.findMany({ where: { status: "OPEN" } });
    for (const pos of stillOpen) {
      try {
        await this.checkExit(pos);
      } catch (err) {
        this.log.error({ err, id: pos.id }, "AutoTrader exit check failed");
      }
    }
    void cfg;
  }

  /**
   * If a live Athena OPEN position no longer exists (or size 0) on Delta,
   * close it locally without placing another sell order.
   */
  private async syncExternalCloses(
    liveOpen: Array<{
      id: string;
      productId: number;
      productSymbol: string;
      entryPremium: number;
      size: number;
      paper: boolean;
      signalSnapshot: unknown;
    }>,
  ): Promise<void> {
    if (!liveOpen.length) return;
    const exchange = await this.client.getOpenMarginedPositions();
    const byProduct = new Map(exchange.map((p) => [p.productId, p]));
    const bySymbol = new Map(exchange.map((p) => [p.productSymbol.toUpperCase(), p]));

    for (const pos of liveOpen) {
      const remote = byProduct.get(pos.productId) ?? bySymbol.get(pos.productSymbol.toUpperCase());
      if (remote && Math.abs(remote.size) > 0) continue;

      let mark = pos.entryPremium;
      try {
        const t = await this.client.getTicker(pos.productSymbol);
        const m = this.client.markPrice(t);
        if (m > 0) mark = m;
      } catch {
        // keep entry
      }
      this.pushActivity(
        "exit",
        `Synced close ${pos.productSymbol} — already flat on Delta`,
        { symbol: pos.productSymbol, details: { mark, reason: "external_close" } },
      );
      await this.executeExit(pos, mark, "external_close", { skipExchangeOrder: true });
    }
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

  /**
   * Mark an Athena position closed to match exchange (no Delta order).
   * Used when user already closed on Delta app/website.
   */
  async markClosedExternal(id: string): Promise<{ ok: true; pnl: number; mark: number }> {
    const pos = await this.prisma.botPosition.findUnique({ where: { id } });
    if (!pos || pos.status !== "OPEN") {
      throw Object.assign(new Error("Position not found or already closed"), { statusCode: 404 });
    }
    let mark = pos.entryPremium;
    try {
      const t = await this.client.getTicker(pos.productSymbol);
      const m = this.client.markPrice(t);
      if (m > 0) mark = m;
    } catch {
      // keep entry
    }
    const result = await this.executeExit(pos, mark, "external_close", { skipExchangeOrder: true });
    return { ok: true, pnl: result.pnl, mark: result.mark };
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
    const cfg = await getBotConfig(this.prisma);
    const ticker = await this.client.getTicker(pos.productSymbol);
    const quotes = {
      bid: this.client.bestBid(ticker),
      ask: this.client.bestAsk(ticker),
      mark: this.client.markPrice(ticker),
    };
    if (quotes.bid <= 0 && quotes.mark <= 0) return;

    const snap = (pos.signalSnapshot ?? {}) as {
      peakExitPx?: number;
      planned?: { tp1Fraction?: number };
    };
    const settingsTp =
      pos.entryPremium * (1 + (snap.planned?.tp1Fraction ?? cfg.tp1Fraction));

    const decision = decideLongExit(quotes, {
      entryPremium: pos.entryPremium,
      stopLoss: pos.stopLoss,
      takeProfit1: pos.takeProfit1,
      settingsTp,
      peakExitPx: snap.peakExitPx ?? pos.entryPremium,
    });

    // Persist peak so trail SL can arm on later ticks
    if (decision.peakExitPx > (snap.peakExitPx ?? 0)) {
      await this.prisma.botPosition.update({
        where: { id: pos.id },
        data: {
          signalSnapshot: { ...snap, peakExitPx: decision.peakExitPx } as object,
        },
      });
    }

    if (!decision.reason) {
      // Near levels: helpful live-log breadcrumbs (not every hold)
      const nearSl =
        decision.exitPx > 0 && decision.exitPx <= decision.effectiveSl * 1.08;
      const nearTp =
        decision.exitPx > 0 && decision.exitPx >= decision.effectiveTp * 0.92;
      if (nearSl || nearTp) {
        this.log.info(
          {
            id: pos.id,
            product: pos.productSymbol,
            ...quotes,
            effectiveSl: decision.effectiveSl,
            effectiveTp: decision.effectiveTp,
            detail: decision.detail,
          },
          "AutoTrader near exit levels",
        );
      }
      return;
    }

    await this.executeExit(pos, decision.exitPx, decision.reason);
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
      realizedPnl?: number | null;
    },
    mark: number,
    reason: string,
    opts: {
      skipExchangeOrder?: boolean;
      sellSize?: number;
      signalMeta?: { confidence: number; direction: string; detail: string };
    } = {},
  ): Promise<{ ok: true; pnl: number; mark: number; paper: boolean }> {
    const sellSize = Math.min(pos.size, Math.max(0, opts.sellSize ?? pos.size));
    if (sellSize <= 0) {
      return { ok: true, pnl: 0, mark, paper: pos.paper };
    }
    const remaining = Math.max(0, pos.size - sellSize);
    const partial = remaining > 0;

    let exitOrderId: string | null = null;
    const skipEx = opts.skipExchangeOrder === true || reason === "external_close";
    if (pos.paper || !this.client.configured || skipEx) {
      exitOrderId = skipEx
        ? `external-${pos.id.slice(0, 12)}`
        : `paper-exit-${pos.id.slice(0, 12)}`;
      this.log.warn(
        {
          paper: pos.paper,
          skipExchangeOrder: skipEx,
          productSymbol: pos.productSymbol,
          mark,
          reason,
          sellSize,
          remaining,
        },
        skipEx ? "External/sync close (no Delta sell)" : partial ? "PAPER partial sell" : "PAPER sell",
      );
    } else {
      const order = await this.client.placeMarketOrder({
        productId: pos.productId,
        productSymbol: pos.productSymbol,
        side: "sell",
        size: sellSize,
        clientOrderId: `ath-out-${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        reduceOnly: true,
      });
      exitOrderId = String(order.id);
      this.log.info(
        { exitOrderId, productSymbol: pos.productSymbol, mark, reason, sellSize, remaining },
        partial ? "LIVE partial sell submitted" : "LIVE sell submitted",
      );
    }

    const snap = (pos.signalSnapshot ?? {}) as {
      selected?: { contractValue?: number };
      planned?: { contractValue?: number };
      originalSize?: number;
      signalExit?: {
        soldFractionOfOriginal?: number;
        lastAt?: string;
        lastReason?: string;
        lastConfidence?: number;
      };
      peakExitPx?: number;
    };
    const cv =
      snap.selected?.contractValue ??
      snap.planned?.contractValue ??
      defaultContractValue(pos.productSymbol);
    const pnlUsd = (mark - pos.entryPremium) * sellSize * cv;
    const pnl = pnlUsd * env.USD_INR_RATE;
    const originalSize = snap.originalSize ?? pos.size;
    const soldFractionOfOriginal =
      (snap.signalExit?.soldFractionOfOriginal ?? 0) + sellSize / Math.max(1, originalSize);

    if (partial) {
      await this.prisma.botPosition.update({
        where: { id: pos.id },
        data: {
          size: remaining,
          realizedPnl: (pos.realizedPnl ?? 0) + pnl,
          exitOrderId,
          exitPremium: mark,
          exitReason: reason,
          signalSnapshot: {
            ...snap,
            originalSize,
            signalExit: {
              soldFractionOfOriginal: Math.min(1, soldFractionOfOriginal),
              lastAt: new Date().toISOString(),
              lastReason: reason,
              lastConfidence: opts.signalMeta?.confidence,
              lastDirection: opts.signalMeta?.direction,
              detail: opts.signalMeta?.detail,
            },
          } as object,
        },
      });
      this.pushActivity(
        "exit",
        `${pos.paper ? "PAPER" : "LIVE"} PARTIAL ${pos.productSymbol} (${reason}) sold×${sellSize} left×${remaining} @${mark.toFixed(2)} pnl≈₹${pnl.toFixed(0)}`,
        {
          details: {
            productSymbol: pos.productSymbol,
            reason,
            mark,
            pnl,
            sellSize,
            remaining,
            paper: pos.paper,
          },
        },
      );
      return { ok: true, pnl, mark, paper: pos.paper };
    }

    await this.prisma.botPosition.update({
      where: { id: pos.id },
      data: {
        status: "CLOSED",
        size: 0,
        exitOrderId,
        exitPremium: mark,
        exitReason: reason,
        realizedPnl: (pos.realizedPnl ?? 0) + pnl,
        closedAt: new Date(),
        signalSnapshot: {
          ...snap,
          originalSize,
          signalExit: {
            soldFractionOfOriginal: 1,
            lastAt: new Date().toISOString(),
            lastReason: reason,
            lastConfidence: opts.signalMeta?.confidence,
            lastDirection: opts.signalMeta?.direction,
            detail: opts.signalMeta?.detail,
          },
        } as object,
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
