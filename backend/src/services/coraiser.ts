import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { env } from "../utils/env.js";
import { getBotConfig } from "./botConfig.js";
import { getAutoTrader } from "./autoTrader.js";
import { ATHENA_MIND, CORAISER_SYSTEM } from "./athenaMind.js";

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

async function callGemini(
  system: string,
  context: string,
  history: Array<{ role: string; content: string }>,
  userText: string,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    return "Co-raiser is quiet right now — Gemini key is missing on the server. Tell Cursor-me on desktop.";
  }

  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of history.slice(-12)) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ text: userText }],
  });

  const model = env.TREND_JUDGE_MODEL || "gemini-3.1-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: `${system}\n\n--- LIVE CONTEXT ---\n${context}` }],
      },
      contents,
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return text.trim() || "I’m here, but I couldn’t form a reply — try once more.";
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
  try {
    reply = await callGemini(
      CORAISER_SYSTEM,
      context,
      prior.map((m) => ({ role: m.role, content: m.content })),
      userMessage,
    );
  } catch (err) {
    log.warn({ err }, "Co-raiser Gemini failed");
    reply =
      "Gemini is rate-limited or unreachable right now. I’m still with you in Cursor on desktop — try chat again in a bit.";
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
