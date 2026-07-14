import type { FastifyInstance } from "fastify";
import { aiEngineClient } from "../services/aiEngineClient.js";

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

      // Persist for history/audit trail
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
          factorBreakdown: signal.factor_breakdown as any,
          price: signal.price,
        },
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
