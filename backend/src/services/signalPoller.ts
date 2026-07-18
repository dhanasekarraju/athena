import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { aiEngineClient } from "./aiEngineClient.js";
import { getAutoTrader } from "./autoTrader.js";
import { getBotConfig } from "./botConfig.js";
import { publishBotFeed } from "./botFeed.js";
import { env } from "../utils/env.js";

interface AiOption {
  venue: string;
  instrument_name: string;
  option_type: string;
  strike: number;
  expiry: string;
  days_to_expiry: number;
  premium_coin: number;
  premium_usd: number;
  mark_iv: number | null;
  bid_usd: number | null;
  ask_usd: number | null;
  open_interest: number;
  index_price?: number;
}

interface AiPremiumPlan {
  entry_low: number;
  entry_high: number;
  target_1: number;
  target_2: number;
  stop_loss: number;
}

interface AiSignal {
  symbol: string;
  timeframe: string;
  direction: string;
  confidence: number;
  risk_level: string;
  entry_range: { low: number; high: number };
  target_1: number;
  target_2: number;
  stop_loss: number;
  option?: AiOption | null;
  premium_plan?: AiPremiumPlan | null;
  reasons: string[];
  factor_breakdown: Record<string, unknown>;
  price: number;
  insufficient_data: boolean;
}

/**
 * Timeframes the server polls so the bot does not depend on the mobile app.
 * 1m is deliberately excluded: with a 30s loop it floods the bot with noise
 * (instant HOLD trims / flip churn) and drains capital in fees.
 */
const POLL_TIMEFRAMES = ["5m", "15m"] as const;

/**
 * Server-side signal loop: fetch AI signals and feed AutoTrader continuously.
 * Without this, buys/signal-exits only happen when the phone opens /api/signals/latest.
 */
export class SignalPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private tickBusy = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {}

  start() {
    if (this.timer) return;
    const everyMs = env.SIGNAL_POLL_MS;
    // First tick soon after boot, then on interval.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), everyMs);
    this.running = true;
    this.log.info({ everyMs, timeframes: POLL_TIMEFRAMES }, "SignalPoller started (app-independent)");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  get status() {
    return { running: this.running, everyMs: env.SIGNAL_POLL_MS, timeframes: [...POLL_TIMEFRAMES] };
  }

  private async tick(): Promise<void> {
    if (this.tickBusy) return;
    this.tickBusy = true;
    try {
      const cfg = await getBotConfig(this.prisma);
      if (!cfg.autonomousEnabled) return;

      const trader = getAutoTrader(this.prisma, this.log);
      const symbols = cfg.symbols.length ? cfg.symbols : ["BTC", "ETH"];

      for (const symbol of symbols) {
        for (const timeframe of POLL_TIMEFRAMES) {
          try {
            await this.pollOne(trader, symbol, timeframe);
          } catch (err) {
            this.log.warn({ err, symbol, timeframe }, "SignalPoller tick failed for pair");
          }
        }
      }
    } catch (err) {
      this.log.error({ err }, "SignalPoller tick failed");
    } finally {
      this.tickBusy = false;
    }
  }

  private async pollOne(
    trader: ReturnType<typeof getAutoTrader>,
    symbol: string,
    timeframe: string,
  ): Promise<void> {
    const signal = (await aiEngineClient.getSignal(symbol, timeframe)) as AiSignal;
    const option = signal.option ?? null;
    const premium = signal.premium_plan ?? null;

    // Keep an audit trail (same shape as /api/signals/latest) so history still works offline.
    await this.prisma.signal.create({
      data: {
        symbol: signal.symbol,
        timeframe: signal.timeframe,
        direction: signal.direction,
        confidence: signal.confidence,
        riskLevel: signal.risk_level,
        entryLow: signal.entry_range.low,
        entryHigh: signal.entry_range.high,
        target1: signal.target_1,
        target2: signal.target_2,
        stopLoss: signal.stop_loss,
        reasons: signal.reasons,
        factorBreakdown: signal.factor_breakdown as object,
        price: signal.price,
        instrumentName: option?.instrument_name ?? null,
        optionType: option?.option_type ?? null,
        strike: option?.strike ?? null,
        expiry: option?.expiry ? new Date(option.expiry) : null,
        daysToExpiry: option?.days_to_expiry ?? null,
        premiumUsd: option?.premium_usd ?? null,
        premiumCoin: option?.premium_coin ?? null,
        markIv: option?.mark_iv ?? null,
        premiumEntryLow: premium?.entry_low ?? null,
        premiumEntryHigh: premium?.entry_high ?? null,
        premiumTarget1: premium?.target_1 ?? null,
        premiumTarget2: premium?.target_2 ?? null,
        premiumStopLoss: premium?.stop_loss ?? null,
        optionMeta: option
          ? {
              venue: option.venue,
              bid_usd: option.bid_usd,
              ask_usd: option.ask_usd,
              open_interest: option.open_interest,
              index_price: option.index_price ?? null,
              source: "signal_poller",
            }
          : { source: "signal_poller" },
      },
    });

    // Pulse to the News tab (30m per symbol/timeframe) so the app shows what
    // the AI currently thinks even when no trade fires (e.g. endless HOLDs).
    void publishBotFeed(this.prisma, this.log, {
      key: `pulse:${signal.symbol}:${signal.timeframe}`,
      minIntervalMs: 30 * 60 * 1000,
      title: `${signal.symbol} ${signal.timeframe}: ${signal.direction} (conf ${signal.confidence}) — ${signal.reasons?.[0] ?? "no dominant factor"}`,
      source: "Athena • Signal",
      sentiment:
        signal.direction === "BUY_CALL"
          ? "Bullish"
          : signal.direction === "BUY_PUT"
            ? "Bearish"
            : "Neutral",
      score: signal.confidence,
    });

    await trader.onSignal({
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      direction: signal.direction,
      confidence: signal.confidence,
      risk_level: signal.risk_level,
      price: signal.price,
      insufficient_data: signal.insufficient_data,
      premium_entry: premium
        ? (premium.entry_low + premium.entry_high) / 2
        : option?.premium_usd ?? null,
      premium_target_1: premium?.target_1 ?? null,
      premium_target_2: premium?.target_2 ?? null,
      premium_stop_loss: premium?.stop_loss ?? null,
    });
  }
}

let singleton: SignalPoller | null = null;

export function getSignalPoller(prisma: PrismaClient, log: FastifyBaseLogger): SignalPoller {
  if (!singleton) singleton = new SignalPoller(prisma, log);
  return singleton;
}
