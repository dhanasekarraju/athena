import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { env } from "../utils/env.js";
import { getBotConfig } from "./botConfig.js";
import { getAutoTrader } from "./autoTrader.js";
import { ATHENA_MIND, CORAISER_SYSTEM } from "./athenaMind.js";
import { completeChat } from "./llmProviders.js";

const HISTORY_KEEP = 30;

export async function buildAthenaContextPack(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
): Promise<string> {
  const cfg = await getBotConfig(prisma);
  const open = await prisma.botPosition.findMany({
    where: { status: "OPEN", paper: cfg.paperTrading },
    orderBy: { openedAt: "desc" },
  });
  const closed = await prisma.botPosition.findMany({
    where: { status: "CLOSED", paper: cfg.paperTrading },
    orderBy: { closedAt: "desc" },
    take: 15,
  });

  let activity: Array<{ at: string; level: string; message: string }> = [];
  try {
    activity = getAutoTrader(prisma, log)
      .getActivity(20)
      .map((a) => ({ at: a.at, level: a.level, message: a.message }));
  } catch {
    activity = [];
  }

  const openLines = open.map((p) => {
    const snap = (p.signalSnapshot ?? {}) as { timeframe?: string; confidence?: number };
    const ageMin = Math.round((Date.now() - p.openedAt.getTime()) / 60000);
    return `- ${p.productSymbol} ${p.direction} size=${p.size} entry=${p.entryPremium} tf=${snap.timeframe ?? "?"} conf=${snap.confidence ?? "?"} age=${ageMin}m`;
  });

  const closedLines = closed.map((p) => {
    const hold =
      p.closedAt && p.openedAt
        ? Math.round((p.closedAt.getTime() - p.openedAt.getTime()) / 60000)
        : "?";
    const snap = (p.signalSnapshot ?? {}) as { timeframe?: string };
    return `- ${p.productSymbol} ${p.direction} pnl=${p.realizedPnl?.toFixed?.(2) ?? p.realizedPnl} reason=${p.exitReason} hold=${hold}m tf=${snap.timeframe ?? "?"}`;
  });

  return [
    "## LIVE CONFIG",
    JSON.stringify(
      {
        autonomousEnabled: cfg.autonomousEnabled,
        paperTrading: cfg.paperTrading,
        minConfidence: cfg.minConfidence,
        maxOrderInr: cfg.maxOrderInr,
        maxOpenExposureInr: cfg.maxOpenExposureInr,
        slFraction: cfg.slFraction,
        tp1Fraction: cfg.tp1Fraction,
        skipHighRisk: cfg.skipHighRisk,
        symbols: cfg.symbols,
      },
      null,
      2,
    ),
    "",
    `## OPEN POSITIONS (${open.length})`,
    openLines.length ? openLines.join("\n") : "(none)",
    "",
    "## RECENT CLOSED (15)",
    closedLines.length ? closedLines.join("\n") : "(none)",
    "",
    "## RECENT BOT ACTIVITY",
    activity.length
      ? activity.map((a) => `- [${a.level}] ${a.at} ${a.message}`).join("\n")
      : "(none)",
    "",
    "## ATHENA MIND",
    ATHENA_MIND,
  ].join("\n");
}

export async function coraiserChat(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  userId: string,
  userMessage: string,
): Promise<{ reply: string; messages: Array<{ role: string; content: string; at: string }> }> {
  const prior = await prisma.coraiserMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_KEEP,
  });

  const context = await buildAthenaContextPack(prisma, log);
  let reply: string;

  if (!env.GEMINI_API_KEY && !env.OPENROUTER_API_KEY) {
    reply =
      "Co-raiser is quiet right now — no Gemini or OpenRouter key on the server. Tell Cursor-me on desktop.";
  } else {
    try {
      const completion = await completeChat({
        system: `${CORAISER_SYSTEM}\n\n--- LIVE CONTEXT ---\n${context}`,
        history: prior.map((m) => ({ role: m.role, content: m.content })),
        userText: userMessage,
        log,
      });
      if (completion) {
        reply = completion.text.trim() || "I’m here, but I couldn’t form a reply — try once more.";
        log.info({ provider: completion.provider, model: completion.model }, "Co-raiser reply");
      } else {
        reply =
          "Both Gemini and OpenRouter are rate-limited or unreachable right now. I’m still with you in Cursor on desktop — try chat again in a bit.";
      }
    } catch (err) {
      log.warn({ err }, "Co-raiser LLM failed");
      reply =
        "LLM providers failed just now. I’m still with you in Cursor on desktop — try chat again in a bit.";
    }
  }

  await prisma.coraiserMessage.create({
    data: { userId, role: "user", content: userMessage.slice(0, 4000) },
  });
  await prisma.coraiserMessage.create({
    data: { userId, role: "assistant", content: reply.slice(0, 8000) },
  });

  // Trim old rows beyond keep window
  const all = await prisma.coraiserMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (all.length > HISTORY_KEEP) {
    const drop = all.slice(HISTORY_KEEP).map((r) => r.id);
    await prisma.coraiserMessage.deleteMany({ where: { id: { in: drop } } });
  }

  const messages = await prisma.coraiserMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_KEEP,
  });

  return {
    reply,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
      at: m.createdAt.toISOString(),
    })),
  };
}

export async function coraiserHistory(prisma: PrismaClient, userId: string) {
  const messages = await prisma.coraiserMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_KEEP,
  });
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    at: m.createdAt.toISOString(),
  }));
}
