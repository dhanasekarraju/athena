import type { FastifyInstance } from "fastify";
import { aiEngineClient } from "../services/aiEngineClient.js";
import { getAutoTrader } from "../services/autoTrader.js";

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
  underlying_plan?: {
    entry_range: { low: number; high: number };
    target_1: number;
    target_2: number;
    stop_loss: number;
  };
  option?: AiOption | null;
  premium_plan?: AiPremiumPlan | null;
  reasons: string[];
  factor_breakdown: Record<string, unknown>;
  price: number;
  insufficient_data: boolean;
}

export default async function signalRoutes(app: FastifyInstance) {
  app.get("/api/signals/latest", async (request, reply) => {
    const { symbol = "BTC", timeframe = "15m" } = request.query as {
      symbol?: string;
      timeframe?: string;
    };

    try {
      const signal = (await aiEngineClient.getSignal(symbol, timeframe)) as AiSignal;
      const option = signal.option ?? null;
      const premium = signal.premium_plan ?? null;

      await app.prisma.signal.create({
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
              }
            : undefined,
        },
      });

      // Fire-and-forget cautious Delta entry (respects AUTONOMOUS_TRADING + risk caps)
      void getAutoTrader(app.prisma, app.log).onSignal({
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
        reasons: signal.reasons,
      });

      return reply.send(signal);
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: "Signal engine unavailable" });
    }
  });

  app.get("/api/signals/history", async (request, reply) => {
    const { symbol, timeframe, limit = "50" } = request.query as {
      symbol?: string;
      timeframe?: string;
      limit?: string;
    };

    const history = await app.prisma.signal.findMany({
      where: {
        ...(symbol ? { symbol } : {}),
        ...(timeframe ? { timeframe } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(limit) || 50, 200),
    });

    return reply.send({ history });
  });
}
