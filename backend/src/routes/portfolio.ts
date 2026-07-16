import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../utils/env.js";
import { DeltaClient } from "../services/delta/client.js";

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

    const cfg = await app.prisma.botConfig.findUnique({ where: { id: "default" } });
    const paperMode = cfg?.paperTrading ?? true;
    const modeFilter = { paper: paperMode };

    const botOpen = await app.prisma.botPosition.findMany({
      where: { status: "OPEN", ...modeFilter },
      orderBy: { openedAt: "desc" },
    });
    const botClosed = await app.prisma.botPosition.findMany({
      where: { status: "CLOSED", ...modeFilter },
      orderBy: { closedAt: "desc" },
      take: 50,
    });
    const botWins = botClosed.filter((p) => (p.realizedPnl ?? 0) > 0).length;
    const botLosses = botClosed.filter((p) => (p.realizedPnl ?? 0) <= 0).length;
    const botPnl = botClosed.reduce((acc, p) => acc + (p.realizedPnl ?? 0), 0);
    const botClosedCount = botClosed.length;

    const client = DeltaClient.fromEnv(env);

    const defaultCv = (sym: string) => {
      const u = sym.toUpperCase();
      if (u.includes("BTC")) return 0.001;
      if (u.includes("ETH")) return 0.01;
      return 1;
    };
    const costInr = (p: (typeof botOpen)[0], mark?: number) => {
      const snap = p.signalSnapshot as {
        selected?: { contractValue?: number };
        planned?: { costInr?: number; contractValue?: number };
        originalSize?: number;
      } | null;
      const cv = snap?.selected?.contractValue ?? snap?.planned?.contractValue ?? defaultCv(p.productSymbol);
      // Always price * remaining size. Do NOT use planned.costInr as-is:
      // that value is for originalSize and makes unrealized deeply negative after partial exits.
      const px = mark ?? p.entryPremium;
      return px * cv * p.size * env.USD_INR_RATE;
    };

    const enrichedOpen = [];
    for (const p of botOpen) {
      let mark = p.entryPremium;
      try {
        const t = await client.getTicker(p.productSymbol);
        const m = client.markPrice(t);
        if (m > 0) mark = m;
      } catch {
        // keep entry as mark fallback
      }
      const snap = p.signalSnapshot as { selected?: { contractValue?: number }; planned?: { contractValue?: number } } | null;
      const cv = snap?.selected?.contractValue ?? snap?.planned?.contractValue ?? defaultCv(p.productSymbol);
      const entryCost = costInr(p);
      const markCost = mark * cv * p.size * env.USD_INR_RATE;
      const unrealizedInr = markCost - entryCost;
      enrichedOpen.push({
        ...p,
        markPremium: mark,
        contractValue: cv,
        entryCostInr: Math.round(entryCost * 100) / 100,
        markCostInr: Math.round(markCost * 100) / 100,
        unrealizedPnlInr: Math.round(unrealizedInr * 100) / 100,
      });
    }

    const botClosedAll = await app.prisma.botPosition.findMany({
      where: { status: "CLOSED", ...modeFilter },
      select: { realizedPnl: true },
    });
    const realizedAll = botClosedAll.reduce((acc, p) => acc + (p.realizedPnl ?? 0), 0);

    const openNotional = enrichedOpen.reduce((acc, p) => acc + p.entryCostInr, 0);
    const openUnrealized = enrichedOpen.reduce((acc, p) => acc + p.unrealizedPnlInr, 0);
    const openPaper = paperMode ? botOpen.length : 0;
    const openLive = paperMode ? 0 : botOpen.length;

    let deltaUsdAvailable: number | null = null;
    let availableBalanceInr: number;
    let balanceLabel: string;

    if (paperMode) {
      const start = env.PAPER_BALANCE_INR;
      availableBalanceInr = Math.round((start + realizedAll - openNotional) * 100) / 100;
      balanceLabel = "Paper available";
    } else {
      deltaUsdAvailable = await client.getUsdAvailable();
      availableBalanceInr =
        deltaUsdAvailable == null
          ? 0
          : Math.round(deltaUsdAvailable * env.USD_INR_RATE * 100) / 100;
      balanceLabel = "Delta USD≈INR";
    }

    const totalPnlCombined = Math.round((realizedAll + openUnrealized) * 100) / 100;
    const equityInr = paperMode
      ? Math.round((availableBalanceInr + openNotional + openUnrealized) * 100) / 100
      : Math.round((availableBalanceInr + openUnrealized) * 100) / 100;

    const totalTrades = botClosedCount;
    const wins = botWins;
    const losses = botLosses;
    const totalPnl = botPnl;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

    return reply.send({
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalPnlInr: totalPnlCombined,
      realizedPnlInr: Math.round(realizedAll * 100) / 100,
      openCount: botOpen.length,
      openNotional: Math.round(openNotional * 100) / 100,
      openUnrealizedPnl: Math.round(openUnrealized * 100) / 100,
      openPaper,
      openLive,
      paperMode,
      balanceLabel,
      availableBalanceInr,
      equityInr,
      paperStartInr: env.PAPER_BALANCE_INR,
      deltaUsdAvailable,
      currencyNote: paperMode
        ? "Paper mode — stats are paper-only"
        : "Live mode — stats are live-only (paper history cleared on switch)",
      openPositions: enrichedOpen,
      recentClosed: botClosed.slice(0, 20),
      manual: {
        totalTrades: manualTotal,
        wins: manualWins,
        losses: manualTotal - manualWins,
        totalPnl: Math.round(manualPnl * 100) / 100,
      },
    });
  });
}
