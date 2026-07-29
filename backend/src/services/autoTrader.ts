import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { env } from "../utils/env.js";
import { DeltaClient } from "./delta/client.js";
import { selectDeltaOption, contractCostUsd } from "./delta/selectOption.js";
import { getBotConfig, type RuntimeBotConfig } from "./botConfig.js";
import { evaluateEntryGuards } from "./entryGuards.js";
import { botActivityToFeedItem, publishBotFeed } from "./botFeed.js";
import { buildEntryLevels, decideLongExit, probeHasRaised, shouldQuickFailExit } from "./exitLogic.js";
import { getTrendVerdict, shouldMomentumExit, verdictAllows, isTrendJudgeLive } from "./trendJudge.js";
import { notifyBuy, notifySell, notifyTrade } from "./pushService.js";
import { extractFilledSize, reconcileEntryFill } from "./orderFill.js";
import { EXAM_RISK_PCT_OF_EQUITY } from "./examDesk.js";
import { sizeExamContracts } from "./examSizing.js";
import {
  countTrailingStopLosses,
  evaluateCircuitBreaker,
  startOfIstTradingDay,
} from "./circuitBreaker.js";
import { getUsdInrRate } from "./usdInr.js";

function defaultContractValue(symbol: string): number {
  const u = symbol.toUpperCase();
  if (u.includes("BTC")) return 0.001;
  if (u.includes("ETH")) return 0.01;
  return 1;
}

/** Parse C-ETH-1950-310726 / P-BTC-... into underlying + direction. */
function parseProductSymbol(
  productSymbol: string,
): { underlying: string; direction: "BUY_CALL" | "BUY_PUT" } | null {
  const m = productSymbol.toUpperCase().match(/^(C|P)-([A-Z0-9]+)-/);
  if (!m) return null;
  return {
    underlying: m[2],
    direction: m[1] === "C" ? "BUY_CALL" : "BUY_PUT",
  };
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
  /** Throttle Gemini momentum-exit checks per position (monitor is 5s). */
  private readonly momentumExitCheckedAt = new Map<string, number>();

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
    notifyTrade(this.prisma, this.log, {
      title: "Athena kill switch ON",
      body: reason,
    });
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
    const guard = evaluateEntryGuards({
      symbol: sym,
      direction: signal.direction,
      confidence: signal.confidence,
      riskLevel: signal.risk_level,
      timeframe: signal.timeframe,
      minConfidence: cfg.minConfidence,
      skipHighRisk: cfg.skipHighRisk,
      allowOneMinuteEntry: true,
      allowSlowTimeframeEntry: true,
      reasonCount: signal.reasons?.length ?? 0,
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

      // Grace: price SL/TP/trail protect immediately; flip sell waits briefly.
      const ageMs = Date.now() - new Date(pos.openedAt).getTime();
      if (ageMs < 5 * 60 * 1000) continue;

      let exitPx = pos.entryPremium;
      let markPx = 0;
      let bidPx = 0;
      try {
        const t = await this.client.getTicker(pos.productSymbol);
        bidPx = this.client.bestBid(t);
        markPx = this.client.markPrice(t);
        exitPx = bidPx > 0 ? bidPx : markPx > 0 ? markPx : pos.entryPremium;
      } catch {
        // keep entry
      }

      const snap = (pos.signalSnapshot ?? {}) as {
        timeframe?: string;
        peakExitPx?: number;
      };
      // Exam Paper 1: never AI-flip-dump a green/raising book — leave to trail/SL/TP.
      const raised = probeHasRaised({
        entryPremium: pos.entryPremium,
        exitPx,
        markPx,
        peakExitPx: snap.peakExitPx,
      });
      if (raised) {
        this.log.info(
          {
            id: pos.id,
            product: pos.productSymbol,
            entry: pos.entryPremium,
            bid: bidPx,
            mark: markPx,
            peak: snap.peakExitPx,
            signalDirection: signal.direction,
            timeframe: snap.timeframe,
          },
          "Skip signal_flip on green position — leave to trail/SL",
        );
        continue;
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
    const fx = await getUsdInrRate(this.log);
    const usdInr = fx.rate;
    if (fx.warned) {
      this.pushActivity("info", `FX note: ${fx.warned}`, {
        details: { rate: usdInr, source: fx.source },
      });
    }
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
    // Gemini guides freely, with one portfolio invariant: never hold both
    // CALL and PUT on the same underlying. A real flip must close the old side
    // before the new side can open.
    const verdict = await getTrendVerdict(sym, this.log);
    if (isTrendJudgeLive(verdict.source)) {
      void publishBotFeed(this.prisma, this.log, {
        key: `trend:${sym}:${verdict.trend}`,
        minIntervalMs: env.TREND_JUDGE_TTL_MS,
        title: `Trend (${verdict.source}) on ${sym}: ${verdict.trend.toUpperCase()} (${verdict.strength}) — ${verdict.reason}`,
        source: verdict.source === "openrouter" ? "Athena • OpenRouter" : "Athena • Gemini",
        sentiment: verdict.trend === "up" ? "Bullish" : verdict.trend === "down" ? "Bearish" : "Neutral",
        score: verdict.strength,
      });
    }
    this.log.info(
      { symbol: sym, direction: signal.direction, verdict, confidence: signal.confidence },
      "Gemini guidance recorded — entry gates disabled",
    );
    const opposingOpen = open.filter(
      (p) => p.underlying === sym && p.direction !== signal.direction,
    );
    if (opposingOpen.length) {
      const guidance = verdictAllows(
        signal.direction as "BUY_CALL" | "BUY_PUT",
        verdict,
      );
      const oldSide = opposingOpen[0].direction;
      const reason = guidance.ok
        ? `Gemini confirms ${signal.direction}, but ${oldSide} must close before flipping`
        : `Gemini does not confirm flip: ${guidance.why}`;
      this.pushActivity(
        "skip",
        `${sym} ${signal.direction} held — no CALL+PUT hedge (${reason})`,
        {
          symbol: sym,
          details: {
            guardian: "gemini_one_side",
            oldSide,
            wantedSide: signal.direction,
            trend: verdict.trend,
            strength: verdict.strength,
            reason,
          },
        },
      );
      this.log.info(
        { symbol: sym, oldSide, wantedSide: signal.direction, verdict, reason },
        "Gemini guardian blocked CALL+PUT conflict",
      );
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

    this.log.info(
      {
        symbol: sym,
        product: selected.productSymbol,
        bid: selected.bid,
        ask: selected.ask,
        openInterest: selected.openInterest,
        markIv: selected.markIv,
      },
      "Liquidity and regime recorded — entry gates disabled",
    );

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

    // Paper 2 + micro allow-one: 12% risk preferred; 1 lot OK if cash + ≤35% equity.
    let equityInr = env.PAPER_BALANCE_INR;
    let walletInr: number | null = paperMode ? equityInr : null;
    if (!paperMode) {
      try {
        const usdAvail = await this.client.getUsdAvailable();
        if (usdAvail != null) {
          equityInr = usdAvail * usdInr;
          walletInr = equityInr;
        }
      } catch (err) {
        this.log.warn({ err }, "Could not read wallet balance before sizing");
      }
    }

    const sized = sizeExamContracts({
      maxOrderInr: cfg.maxOrderInr,
      exposureRoomInr: room,
      walletInr,
      equityInr,
      costPerContractInr,
    });
    const size = sized.size;
    const budget = sized.budget;
    if (size < 1) {
      this.pushActivity(
        "skip",
        `${sym} skipped — 1× ${selected.productSymbol} ≈ ₹${costPerContractInr.toFixed(0)} > max ₹${budget.toFixed(0)}${
          sized.reason ? ` (${sized.reason})` : ""
        }`,
        {
          symbol: sym,
          details: {
            premiumUsd: premium,
            contractValue: selected.contractValue,
            costPerContractUsd,
            costPerContractInr,
            budget,
            cashBudget: sized.cashBudget,
            riskBudget: sized.riskBudget,
            equityInr,
            riskPct: EXAM_RISK_PCT_OF_EQUITY,
            microAllowOne: sized.microAllowOne,
            why: sized.reason,
            product: selected.productSymbol,
          },
        },
      );
      this.log.info(
        {
          premium,
          costPerContractInr,
          budget,
          cashBudget: sized.cashBudget,
          riskBudget: sized.riskBudget,
          why: sized.reason,
          symbol: selected.productSymbol,
        },
        "Skip auto entry: 1 contract costs more than exam budget",
      );
      return;
    }
    if (sized.microAllowOne) {
      this.log.info(
        { product: selected.productSymbol, costPerContractInr, equityInr, budget },
        "Exam micro allow-one lot (12% risk could not afford 1×)",
      );
    }

    const notionalInr = size * costPerContractInr;
    const notionalUsd = size * costPerContractUsd;
    const clientOrderId = `ath-in-${randomUUID().replace(/-/g, "").slice(0, 24)}`;

    let entryOrderId: string | null = null;
    let fillPremium = premium;
    let fillSize = size;
    const paper = paperMode;
    const requestedSize = size;

    if (paper) {
      entryOrderId = `paper-${clientOrderId}`;
      this.log.warn(
        {
          paper: true,
          product: selected.productSymbol,
          size: fillSize,
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
        size: requestedSize,
        clientOrderId,
      });
      entryOrderId = String(order.id);
      fillPremium = Number(order.average_fill_price || premium) || premium;
      const filledFromOrder = extractFilledSize(order);
      const reconciled = reconcileEntryFill({
        requestedSize,
        filledSize: filledFromOrder,
        state: order.state,
      });

      if (!reconciled.ok) {
        // Unwind any short/bad fill still resting as a long on Delta.
        if (reconciled.fillSize > 0) {
          try {
            const unwindId = `ath-uw-${randomUUID().replace(/-/g, "").slice(0, 22)}`;
            await this.client.placeMarketOrder({
              productId: selected.productId,
              productSymbol: selected.productSymbol,
              side: "sell",
              size: reconciled.fillSize,
              clientOrderId: unwindId,
              reduceOnly: true,
            });
            this.log.warn(
              { fillSize: reconciled.fillSize, why: reconciled.why, product: selected.productSymbol },
              "Unwound short/rejected entry fill",
            );
          } catch (err) {
            this.log.error(
              { err, fillSize: reconciled.fillSize, product: selected.productSymbol },
              "Failed to unwind short entry fill — check Delta book",
            );
            this.pushActivity("error", `${sym} SHORT FILL UNWIND FAILED ×${reconciled.fillSize} ${selected.productSymbol}`, {
              symbol: sym,
              details: { why: reconciled.why, fillSize: reconciled.fillSize },
            });
          }
        }
        this.pushActivity("skip", `${sym} entry aborted — ${reconciled.why}`, {
          symbol: sym,
          details: {
            requestedSize,
            filledSize: reconciled.fillSize,
            state: order.state,
            product: selected.productSymbol,
          },
        });
        this.log.info(
          { orderId: entryOrderId, requestedSize, filled: filledFromOrder, state: order.state, why: reconciled.why },
          "Skip auto entry: fill reconcile",
        );
        return;
      }

      fillSize = reconciled.fillSize;
      this.log.info(
        {
          orderId: entryOrderId,
          product: selected.productSymbol,
          requestedSize,
          fillSize,
          partial: reconciled.partial,
          state: order.state,
        },
        "LIVE buy filled",
      );
    }

    // Delta aggregates repeated buys of one contract. Mirror that invariant in
    // Athena so repeated free entries cannot create duplicate exit rows.
    const existingProduct = await this.prisma.botPosition.findFirst({
      where: {
        status: "OPEN",
        paper,
        productId: selected.productId,
      },
    });
    const totalSize = (existingProduct?.size ?? 0) + fillSize;
    const effectiveEntry = existingProduct
      ? ((existingProduct.entryPremium * existingProduct.size) + (fillPremium * fillSize)) / totalSize
      : fillPremium;

    // SL + TP1 independent: tighter of settings/AI for SL; AI TP1 capped near settings (never wait for TP2).
    const levels = buildEntryLevels({
      fillPremium: effectiveEntry,
      slFraction: cfg.slFraction,
      tp1Fraction: cfg.tp1Fraction,
      aiEntry: signal.premium_entry,
      aiTp1: signal.premium_target_1,
      aiTp2: signal.premium_target_2,
      aiSl: signal.premium_stop_loss,
    });
    const { stopLoss, takeProfit1, tpSource, slSource } = levels;

    const fillCostInr =
      contractCostUsd(fillPremium, selected.contractValue) * fillSize * usdInr;

    const positionData = {
        exchange: "delta",
        productId: selected.productId,
        productSymbol: selected.productSymbol,
        underlying: sym,
        direction: signal.direction,
        size: totalSize,
        entryPremium: effectiveEntry,
        stopLoss,
        takeProfit1,
        status: "OPEN",
        paper,
        entryOrderId,
        signalSnapshot: {
          ...((existingProduct?.signalSnapshot ?? {}) as object),
          timeframe: signal.timeframe,
          confidence: signal.confidence,
          risk_level: signal.risk_level,
          spot: signal.price,
          selected,
          tpSource,
          slSource,
          peakExitPx: Math.max(
            Number(((existingProduct?.signalSnapshot ?? {}) as { peakExitPx?: number }).peakExitPx ?? 0),
            effectiveEntry,
          ),
          originalSize: totalSize,
          requestedSize,
          aiPremium: {
            entry: signal.premium_entry ?? null,
            target_1: signal.premium_target_1 ?? null,
            target_2: signal.premium_target_2 ?? null,
            stop_loss: signal.premium_stop_loss ?? null,
          },
          planned: {
            notionalInr: fillCostInr,
            notionalUsd: fillSize * costPerContractUsd,
            costInr: fillCostInr,
            costPerContractInr,
            contractValue: selected.contractValue,
            usdInr,
            usdInrSource: fx.source,
            budget,
            stopLoss,
            takeProfit1,
            slFraction: cfg.slFraction,
            tp1Fraction: cfg.tp1Fraction,
          },
        } as object,
      };
    if (existingProduct) {
      await this.prisma.botPosition.update({
        where: { id: existingProduct.id },
        data: positionData,
      });
      this.log.info(
        {
          product: selected.productSymbol,
          previousSize: existingProduct.size,
          addedSize: fillSize,
          totalSize,
          effectiveEntry,
        },
        "Merged repeated buy into Athena OPEN",
      );
    } else {
      await this.prisma.botPosition.create({ data: positionData });
    }

    this.pushActivity(
      "trade",
      `${paper ? "PAPER" : "LIVE"} BUY ${signal.direction} ${selected.productSymbol} ×${fillSize}${
        fillSize !== requestedSize ? ` (req ${requestedSize})` : ""
      } @ ${fillPremium.toFixed(2)} (≈₹${fillCostInr.toFixed(0)}) SL ${stopLoss.toFixed(2)} [${slSource}] TP ${takeProfit1.toFixed(2)} [${tpSource}]`,
      {
        symbol: sym,
        details: {
          product: selected.productSymbol,
          size: fillSize,
          requestedSize,
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
    notifyBuy(this.prisma, this.log, {
      paper,
      product: selected.productSymbol,
      direction: signal.direction,
      size: fillSize,
      premium: fillPremium,
      confidence: signal.confidence,
      timeframe: signal.timeframe,
    });
  }

  async monitorOpenPositions(): Promise<void> {
    const cfg = await getBotConfig(this.prisma);
    const open = await this.prisma.botPosition.findMany({ where: { status: "OPEN" } });
    // Sync live books: close Athena if flat on Delta; import Delta longs Athena missed.
    if (!cfg.paperTrading && this.client.configured) {
      try {
        await this.syncExternalCloses(open.filter((p) => !p.paper));
      } catch (err) {
        this.log.error({ err }, "Delta position sync failed");
      }
      try {
        await this.syncExternalOpens(cfg);
      } catch (err) {
        this.log.error({ err }, "Delta open-import sync failed");
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

  /**
   * Import Delta longs Athena does not have as OPEN (manual buys / missed fills).
   */
  private async syncExternalOpens(cfg: RuntimeBotConfig): Promise<void> {
    const exchange = await this.client.getOpenMarginedPositions();
    if (!exchange.length) return;

    const athenaOpen = await this.prisma.botPosition.findMany({
      where: { status: "OPEN", paper: false },
      select: { productId: true, productSymbol: true, size: true },
    });
    const byProduct = new Map(athenaOpen.map((p) => [p.productId, p]));
    const bySymbol = new Map(athenaOpen.map((p) => [p.productSymbol.toUpperCase(), p]));
    const fx = await getUsdInrRate(this.log);
    const usdInr = fx.rate;

    for (const remote of exchange) {
      const size = Math.abs(remote.size);
      if (size <= 0) continue;
      const existing =
        byProduct.get(remote.productId) ?? bySymbol.get(remote.productSymbol.toUpperCase());
      if (existing) {
        if (Math.abs(existing.size - size) >= 1) {
          await this.prisma.botPosition.updateMany({
            where: {
              status: "OPEN",
              paper: false,
              OR: [{ productId: remote.productId }, { productSymbol: remote.productSymbol }],
            },
            data: { size },
          });
          this.log.warn(
            { product: remote.productSymbol, from: existing.size, to: size },
            "Synced Athena OPEN size to Delta",
          );
        }
        continue;
      }

      const meta = parseProductSymbol(remote.productSymbol);
      if (!meta) continue;
      const entry = remote.entryPrice > 0 ? remote.entryPrice : 0;
      if (entry <= 0) continue;

      const levels = buildEntryLevels({
        fillPremium: entry,
        slFraction: cfg.slFraction,
        tp1Fraction: cfg.tp1Fraction,
      });
      const cv = defaultContractValue(remote.productSymbol);
      const costInr = contractCostUsd(entry, cv) * size * usdInr;

      await this.prisma.botPosition.create({
        data: {
          exchange: "delta",
          productId: remote.productId,
          productSymbol: remote.productSymbol,
          underlying: meta.underlying,
          direction: meta.direction,
          size,
          entryPremium: entry,
          stopLoss: levels.stopLoss,
          takeProfit1: levels.takeProfit1,
          status: "OPEN",
          paper: false,
          entryOrderId: `delta-sync-${remote.productId}`,
          signalSnapshot: {
            timeframe: "sync",
            confidence: 0,
            risk_level: "High",
            importedFromDelta: true,
            peakExitPx: entry,
            originalSize: size,
            selected: { contractValue: cv, productSymbol: remote.productSymbol },
            planned: {
              costInr,
              contractValue: cv,
              usdInr,
              stopLoss: levels.stopLoss,
              takeProfit1: levels.takeProfit1,
              slFraction: cfg.slFraction,
              tp1Fraction: cfg.tp1Fraction,
            },
          } as object,
        },
      });
      this.pushActivity(
        "trade",
        `IMPORTED from Delta ${meta.direction} ${remote.productSymbol} ×${size} @ ${entry.toFixed(2)} (≈₹${costInr.toFixed(0)})`,
        { symbol: meta.underlying, details: { product: remote.productSymbol, size, entry, costInr } },
      );
      this.log.warn(
        { product: remote.productSymbol, size, entry, costInr },
        "Imported orphan Delta position into Athena OPEN",
      );
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
    underlying: string;
    direction: string;
    entryPremium: number;
    stopLoss: number;
    takeProfit1: number;
    size: number;
    paper: boolean;
    signalSnapshot: unknown;
    openedAt: Date;
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
      timeframe?: string;
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

    if (decision.reason) {
      await this.executeExit(pos, decision.exitPx, decision.reason);
      return;
    }

    // 1m probe: no raise within 5m → cut (small loss OK; fees same as waiting for deeper SL).
    const exitPx = decision.exitPx > 0 ? decision.exitPx : quotes.mark || quotes.bid;
    const quick = shouldQuickFailExit({
      timeframe: snap.timeframe,
      openedAtMs: pos.openedAt.getTime(),
      entryPremium: pos.entryPremium,
      exitPx,
      markPx: quotes.mark,
      peakExitPx: Math.max(snap.peakExitPx ?? 0, decision.peakExitPx ?? 0) || undefined,
    });
    if (quick.exit) {
      this.pushActivity("exit", `Quick-fail ${pos.productSymbol} — ${quick.why}`, {
        symbol: pos.underlying,
        details: { reason: "quick_fail", exitPx, timeframe: snap.timeframe },
      });
      this.log.info(
        { id: pos.id, product: pos.productSymbol, why: quick.why, exitPx },
        "AutoTrader 1m quick-fail exit",
      );
      await this.executeExit(pos, exitPx, "quick_fail");
      return;
    }

    // Adverse 1m+5m (Gemini): cut small instead of waiting for late AI flip / full SL.
    // Fees are the same at −₹50 or −₹200 — save the extra loss when momentum flipped.
    const lastMom = this.momentumExitCheckedAt.get(pos.id) ?? 0;
    if (Date.now() - lastMom >= 45_000) {
      this.momentumExitCheckedAt.set(pos.id, Date.now());
      try {
        const verdict = await getTrendVerdict(pos.underlying, this.log, {
          maxCacheAgeMs: 60_000,
        });
        const mom = shouldMomentumExit({
          positionDirection: pos.direction as "BUY_CALL" | "BUY_PUT",
          verdict,
          entryPremium: pos.entryPremium,
          exitPx,
          openedAtMs: pos.openedAt.getTime(),
        });
        if (mom.exit) {
          this.pushActivity("exit", `Momentum exit ${pos.productSymbol} — ${mom.why}`, {
            symbol: pos.underlying,
            details: {
              reason: "momentum_flip",
              trend: verdict.trend,
              strength: verdict.strength,
              frames: verdict.frames,
              exitPx,
            },
          });
          this.log.info(
            { id: pos.id, product: pos.productSymbol, verdict, why: mom.why, exitPx },
            "AutoTrader momentum-flip exit",
          );
          await this.executeExit(pos, exitPx, "momentum_flip");
          this.momentumExitCheckedAt.delete(pos.id);
          return;
        }
      } catch (err) {
        this.log.warn({ err, id: pos.id }, "Momentum exit check failed — holding");
      }
    }

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
    // Same live FX path as tryEnter — circuit breaker sums this realizedPnl.
    const fx = await getUsdInrRate(this.log);
    const pnl = pnlUsd * fx.rate;
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
      notifySell(this.prisma, this.log, {
        paper: pos.paper,
        product: pos.productSymbol,
        reason,
        mark,
        pnl,
        partial: true,
      });
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
    notifySell(this.prisma, this.log, {
      paper: pos.paper,
      product: pos.productSymbol,
      reason,
      mark,
      pnl,
    });

    // After a full close, re-check daily / consecutive loss breaker.
    if (!pos.paper) {
      try {
        const cfg = await getBotConfig(this.prisma);
        await this.checkCircuitBreaker(cfg);
      } catch (err) {
        this.log.warn({ err }, "Circuit breaker check after exit failed");
      }
    }

    return { ok: true, pnl, mark, paper: pos.paper };
  }

  /**
   * If daily IST loss or consecutive SLs breach config, kill new entries.
   * @returns true if already killed / just tripped (caller should skip entry)
   */
  private async checkCircuitBreaker(cfg: RuntimeBotConfig): Promise<boolean> {
    if (this.killed) return true;
    if (cfg.dailyLossLimitInr <= 0 && cfg.maxConsecutiveStopLosses <= 0) return false;

    const dayStart = startOfIstTradingDay();
    const closedToday = await this.prisma.botPosition.findMany({
      where: {
        status: "CLOSED",
        paper: cfg.paperTrading,
        closedAt: { gte: dayStart },
      },
      select: { realizedPnl: true },
    });
    const dayRealizedPnlInr = closedToday.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);

    const recent = await this.prisma.botPosition.findMany({
      where: { status: "CLOSED", paper: cfg.paperTrading, exitReason: { not: null } },
      orderBy: { closedAt: "desc" },
      take: 20,
      select: { exitReason: true },
    });
    const consecutiveStopLosses = countTrailingStopLosses(
      recent.map((r) => r.exitReason ?? ""),
    );

    const verdict = evaluateCircuitBreaker({
      dayRealizedPnlInr,
      dailyLossLimitInr: cfg.dailyLossLimitInr,
      consecutiveStopLosses,
      maxConsecutiveStopLosses: cfg.maxConsecutiveStopLosses,
    });
    if (!verdict.trip) return false;

    this.kill(`circuit_breaker: ${verdict.why}`);
    this.pushActivity("info", `Circuit breaker — ${verdict.why}`, {
      details: {
        dayRealizedPnlInr,
        dailyLossLimitInr: cfg.dailyLossLimitInr,
        consecutiveStopLosses,
        maxConsecutiveStopLosses: cfg.maxConsecutiveStopLosses,
        dayStart: dayStart.toISOString(),
      },
    });
    return true;
  }
}

let singleton: AutoTrader | null = null;

export function getAutoTrader(prisma: PrismaClient, log: FastifyBaseLogger): AutoTrader {
  if (!singleton) singleton = new AutoTrader(prisma, log);
  return singleton;
}
