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
  // Manual trade journal (user-logged trades, separate from Delta auto-trader).
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

    // Manual journal stats (legacy)
    const manualClosed = await app.prisma.trade.findMany({ where: { userId, status: "CLOSED" } });
    const manualTotal = manualClosed.length;
    const manualWins = manualClosed.filter((t) => (t.pnl ?? 0) > 0).length;
    const manualPnl = manualClosed.reduce((acc, t) => acc + (t.pnl ?? 0), 0);

    // Auto-trader (paper + live) positions — primary portfolio for bot users
    const botOpen = await app.prisma.botPosition.findMany({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    const botClosed = await app.prisma.botPosition.findMany({
      where: { status: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 50,
    });
    const botWins = botClosed.filter((p) => (p.realizedPnl ?? 0) > 0).length;
    const botLosses = botClosed.filter((p) => (p.realizedPnl ?? 0) <= 0).length;
    const botPnl = botClosed.reduce((acc, p) => acc + (p.realizedPnl ?? 0), 0);
    const botClosedCount = botClosed.length;
    // Approximate open notional (premium * size); mark-to-market not stored here
    const openNotional = botOpen.reduce((acc, p) => acc + p.entryPremium * p.size, 0);
    const openPaper = botOpen.filter((p) => p.paper).length;
    const openLive = botOpen.length - openPaper;

    const totalTrades = botClosedCount;
    const wins = botWins;
    const losses = botLosses;
    const totalPnl = botPnl;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    return reply.send({
      // Headline stats driven by bot trades
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      totalPnl: Math.round(totalPnl * 100) / 100,
      openCount: botOpen.length,
      openNotional: Math.round(openNotional * 100) / 100,
      openPaper,
      openLive,
      openPositions: botOpen,
      recentClosed: botClosed.slice(0, 20),
      // Keep manual journal totals for secondary display if needed
      manual: {
        totalTrades: manualTotal,
        wins: manualWins,
        losses: manualTotal - manualWins,
        totalPnl: Math.round(manualPnl * 100) / 100,
      },
    });
  });
}
