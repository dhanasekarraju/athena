import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { getAutoTrader } from "../services/autoTrader.js";
import { getBotConfig, updateBotConfig } from "../services/botConfig.js";

const ConfigPatchSchema = z.object({
  autonomousEnabled: z.boolean().optional(),
  // paperTrading: false is NOT allowed here — use POST /api/bot/go-live
  paperTrading: z.literal(true).optional(),
  maxOrderInr: z.number().positive().optional(),
  maxOpenExposureInr: z.number().positive().optional(),
  minConfidence: z.number().min(0).max(100).optional(),
  symbols: z.array(z.string()).optional(),
  slFraction: z.number().min(0.05).max(0.9).optional(),
  tp1Fraction: z.number().min(0.05).max(5).optional(),
  skipHighRisk: z.boolean().optional(),
  dailyLossLimitInr: z.number().min(0).optional(),
  maxConsecutiveStopLosses: z.number().int().min(0).max(20).optional(),
  maxSpreadPct: z.number().min(0.01).max(0.5).optional(),
  minOpenInterest: z.number().min(0).optional(),
});

const GoLiveSchema = z.object({
  password: z.string().min(8),
  confirm: z.literal(true),
});

export default async function botRoutes(app: FastifyInstance) {
  app.get("/api/bot/status", { preHandler: [app.authenticate] }, async () => {
    const trader = getAutoTrader(app.prisma, app.log);
    const open = await app.prisma.botPosition.findMany({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    const recent = await app.prisma.botPosition.findMany({
      orderBy: { openedAt: "desc" },
      take: 20,
    });
    return {
      ...(await trader.status()),
      openPositions: open,
      recent,
    };
  });

  app.get("/api/bot/config", { preHandler: [app.authenticate] }, async () => {
    const cfg = await getBotConfig(app.prisma);
    const trader = getAutoTrader(app.prisma, app.log);
    return {
      ...cfg,
      killed: (await trader.status()).killed,
      deltaConfigured: (await trader.status()).deltaConfigured,
    };
  });

  app.get("/api/bot/log", { preHandler: [app.authenticate] }, async (request) => {
    const q = request.query as { limit?: string };
    const limit = Number(q.limit) || 80;
    const trader = getAutoTrader(app.prisma, app.log);
    const status = await trader.status();
    const open = await app.prisma.botPosition.findMany({
      where: { status: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    return {
      status: {
        autonomous: status.autonomous,
        paper: status.paper,
        killed: status.killed,
        minConfidence: status.minConfidence,
        deltaConfigured: status.deltaConfigured,
      },
      openPositions: open,
      events: trader.getActivity(limit),
    };
  });

  app.patch("/api/bot/config", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (body && body.paperTrading === false) {
      return reply.code(400).send({
        error: "Use POST /api/bot/go-live with password + confirm:true to enable live trading",
      });
    }

    const parsed = ConfigPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const trader = getAutoTrader(app.prisma, app.log);
    const cfg = await updateBotConfig(app.prisma, parsed.data);
    const status = await trader.status();
    app.log.info({ cfg }, "BotConfig updated from UI");
    return {
      ...cfg,
      killed: status.killed,
      deltaConfigured: status.deltaConfigured,
    };
  });

  /**
   * Harder path paper → live: requires account password + explicit confirm.
   */
  app.post("/api/bot/go-live", { preHandler: [app.authenticate] }, async (request, reply) => {
    const parsed = GoLiveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const userId = (request.user as { sub: string }).sub;
    const user = await app.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.passwordHash, parsed.data.password))) {
      return reply.code(401).send({ error: "Invalid password" });
    }

    const trader = getAutoTrader(app.prisma, app.log);
    const status = await trader.status();
    if (!status.deltaConfigured) {
      return reply.code(400).send({
        error: "Cannot go live: DELTA_API_KEY / DELTA_API_SECRET not set on server",
      });
    }

    const prev = await getBotConfig(app.prisma);
    if (!prev.paperTrading) {
      return reply.send({
        ...prev,
        killed: status.killed,
        deltaConfigured: status.deltaConfigured,
        alreadyLive: true,
        paperCleared: 0,
      });
    }

    const cfg = await updateBotConfig(app.prisma, { paperTrading: false });
    const paperCleared = await trader.clearPaperBook("switched_to_live");
    app.log.warn({ userId, paperCleared }, "Bot went LIVE via /api/bot/go-live");

    const { notifyTrade } = await import("../services/pushService.js");
    notifyTrade(app.prisma, app.log, {
      title: "Athena went LIVE",
      body: `Paper book cleared (${paperCleared}). Real orders enabled.`,
    });

    return {
      ...cfg,
      killed: (await trader.status()).killed,
      deltaConfigured: true,
      paperCleared,
      alreadyLive: false,
    };
  });

  app.post("/api/bot/kill", { preHandler: [app.authenticate] }, async (_req, reply) => {
    getAutoTrader(app.prisma, app.log).kill("api_kill");
    return reply.send({ ok: true, killed: true });
  });

  app.post("/api/bot/resume", { preHandler: [app.authenticate] }, async (_req, reply) => {
    getAutoTrader(app.prisma, app.log).resume();
    return reply.send({ ok: true, killed: false });
  });

  app.post("/api/bot/positions/:id/close", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const result = await getAutoTrader(app.prisma, app.log).closePosition(id);
      return reply.send(result);
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      const code = e.statusCode === 404 ? 404 : 400;
      return reply.code(code).send({ error: e.message || "Close failed" });
    }
  });
}
