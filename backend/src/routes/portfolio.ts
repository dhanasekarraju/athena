import type { FastifyInstance } from "fastify";
import { z } from "zod";

const TradeSchema = z.object({
  symbol: z.string(),
  direction: z.enum(["BUY_CALL", "BUY_PUT"]),
  entryPrice: z.number().positive(),
  quantity: z.number().positive(),
  stopLoss: z.number().optional(),
  target1: z.number().optional(),
  target2: z.number().optional(),
  notes: z.string().optional(),
});

const CloseTradeSchema = z.object({
  tradeId: z.string(),
  exitPrice: z.number().positive(),
});

export default async function portfolioRoutes(app: FastifyInstance) {
  // NOTE: ATHENA never places orders on an exchange. This endpoint only
  // records a trade the user has already executed manually elsewhere.
  app.post("/api/trades", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = TradeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const userId = (request.user as { sub: string }).sub;
    const trade = await app.prisma.trade.create({
      data: { ...parsed.data, userId, status: "OPEN" },
    });
    return reply.code(201).send({ trade });
  });

  app.post("/api/trades/close", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = CloseTradeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const userId = (request.user as { sub: string }).sub;

    const trade = await app.prisma.trade.findFirst({
      where: { id: parsed.data.tradeId, userId },
    });
    if (!trade) return reply.code(404).send({ error: "Trade not found" });

    const direction = trade.direction === "BUY_CALL" ? 1 : -1;
    const pnl = direction * (parsed.data.exitPrice - trade.entryPrice) * trade.quantity;

    const updated = await app.prisma.trade.update({
      where: { id: trade.id },
      data: { exitPrice: parsed.data.exitPrice, status: "CLOSED", pnl, closedAt: new Date() },
    });
    return reply.send({ trade: updated });
  });

  app.get("/api/trades/history", { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;
    const trades = await app.prisma.trade.findMany({
      where: { userId },
      orderBy: { openedAt: "desc" },
    });
    return reply.send({ trades });
  });

  app.get("/api/portfolio", { preHandler: [app.authenticate] }, async (request, reply) => {
    const userId = (request.user as { sub: string }).sub;
    const trades = await app.prisma.trade.findMany({ where: { userId, status: "CLOSED" } });

    const totalTrades = trades.length;
    const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
    const totalPnl = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    return reply.send({
      totalTrades,
      wins,
      losses: totalTrades - wins,
      winRate: Math.round(winRate * 10) / 10,
      totalPnl: Math.round(totalPnl * 100) / 100,
    });
  });
}
